-- Hotfix Pack 2: reject publisher_type/business_id mismatch; fix catalog views for anon.
-- Catalogs are view-owner definer (no security_invoker) so resolve_listing_publisher can
-- read owner_id without granting owner_id to anon.

CREATE OR REPLACE FUNCTION public.listings_enforce_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  trusted boolean := private.has_trusted_listing_write();
  uid uuid := (select auth.uid());
  biz_status content_status;
  n_active int;
  n_creates int;
  svc_cat uuid;
  published_locked boolean;
begin
  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    new.owner_id := uid;
    new.favorites_count := 0;
    new.moderation_reason := null;
    new.published_at := null;
    new.reserved_at := null;
    new.completed_at := null;
    new.paused_at := null;
    new.archived_at := null;

    if new.publisher_type is null then
      new.publisher_type := 'profile';
    end if;
    if new.publisher_type = 'profile' and new.publisher_business_id is not null then
      raise exception 'publisher_business_id must be null for profile publisher'
        using errcode = '23514';
    end if;

    if not trusted then
      new.status := 'draft';

      -- Rate limit: max 20 listing creates / hour
      select count(*) into n_creates
      from public.review_abuse_events e
      where e.user_id = uid
        and e.kind = 'listing_create'
        and e.created_at > now() - interval '1 hour';
      if n_creates >= 20 then
        raise exception 'listing create rate limit exceeded' using errcode = 'P0001';
      end if;
    end if;

    -- Business publisher checks
    if new.publisher_type = 'business' then
      if new.publisher_business_id is null then
        raise exception 'publisher_business_id required for business publisher' using errcode = 'P0001';
      end if;
      if not trusted then
        if not public.owns_business(new.publisher_business_id) then
          raise exception 'not business owner' using errcode = '42501';
        end if;
      end if;
      select status into biz_status
      from public.businesses where id = new.publisher_business_id;
      if not found then
        raise exception 'business not found' using errcode = 'P0001';
      end if;
      if biz_status is distinct from 'approved' then
        raise exception 'business must be approved to publish as business' using errcode = 'P0001';
      end if;
    end if;

    new.title := btrim(new.title);
    new.description := btrim(new.description);
    if new.city is not null then new.city := btrim(new.city); end if;
    if new.state is not null then new.state := btrim(new.state); end if;
    return new;
  end if;

  -- UPDATE
  new.owner_id := old.owner_id;
  new.listing_type := old.listing_type;
  new.created_at := old.created_at;
  new.favorites_count := old.favorites_count;
  new.title := btrim(new.title);
  new.description := btrim(new.description);
  if new.city is not null then new.city := btrim(new.city); end if;
  if new.state is not null then new.state := btrim(new.state); end if;

  -- Lock publisher after first publish (published_at set or left draft)
  published_locked := (
    old.published_at is not null
    or old.status::text is distinct from 'draft'
  );
  if published_locked then
    new.publisher_type := old.publisher_type;
    new.publisher_business_id := old.publisher_business_id;
  else
    if new.publisher_type is null then
      new.publisher_type := old.publisher_type;
    end if;
    if new.publisher_type = 'profile' and new.publisher_business_id is not null then
      raise exception 'publisher_business_id must be null for profile publisher'
        using errcode = '23514';
    end if;
    if new.publisher_type = 'business' then
      if new.publisher_business_id is null then
        raise exception 'publisher_business_id required for business publisher' using errcode = 'P0001';
      end if;
      if not trusted then
        if not public.owns_business(new.publisher_business_id) then
          raise exception 'not business owner' using errcode = '42501';
        end if;
      end if;
      select status into biz_status
      from public.businesses where id = new.publisher_business_id;
      if not found then
        raise exception 'business not found' using errcode = 'P0001';
      end if;
      if biz_status is distinct from 'approved' then
        raise exception 'business must be approved to publish as business' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if not trusted then
    -- Lock admin/system fields (timestamps set only via this trigger)
    new.moderation_reason := old.moderation_reason;
    new.published_at := old.published_at;
    new.reserved_at := old.reserved_at;
    new.completed_at := old.completed_at;
    new.paused_at := old.paused_at;
    new.archived_at := old.archived_at;
    new.expires_at := old.expires_at;

    -- Block admin statuses for users
    if new.status::text in ('removed', 'rejected', 'expired') then
      raise exception 'status transition not allowed' using errcode = 'P0001';
    end if;
    if old.status::text in ('removed', 'rejected') then
      raise exception 'cannot modify moderated listing' using errcode = 'P0001';
    end if;

    -- Allowed user transitions (type-aware; use ::text for paused same-tx safety)
    if new.status is distinct from old.status then
      if old.listing_type = 'service' then
        if new.status::text = 'reserved' then
          raise exception 'reserved is not allowed for service listings' using errcode = 'P0001';
        end if;
        if not (
          (old.status::text = 'draft' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'active' and new.status::text in ('paused', 'completed', 'archived'))
          or (old.status::text = 'paused' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'completed' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'archived' and new.status::text = 'draft')
        ) then
          raise exception 'invalid status transition from % to %', old.status, new.status
            using errcode = 'P0001';
        end if;
      else
        -- marketplace_item and other types: existing matrix + paused not for marketplace by default
        if new.status::text = 'paused' and old.listing_type is distinct from 'service' then
          raise exception 'paused is only allowed for service listings' using errcode = 'P0001';
        end if;
        if not (
          (old.status::text = 'draft' and new.status::text in ('active', 'archived'))
          or (old.status::text = 'active' and new.status::text in ('reserved', 'completed', 'archived'))
          or (old.status::text = 'reserved' and new.status::text in ('active', 'completed', 'archived'))
          or (old.status::text = 'completed' and new.status::text = 'archived')
          or (old.status::text = 'archived' and new.status::text = 'draft')
        ) then
          raise exception 'invalid status transition from % to %', old.status, new.status
            using errcode = 'P0001';
        end if;
      end if;

      if new.status::text = 'active' and old.status::text = 'draft' then
        new.published_at := coalesce(old.published_at, now());
      end if;
      if new.status::text = 'active' and old.status::text in ('paused', 'completed', 'reserved') then
        new.published_at := coalesce(old.published_at, now());
      end if;
      if new.status::text = 'reserved' then
        new.reserved_at := now();
      end if;
      if new.status::text = 'completed' then
        new.completed_at := now();
      end if;
      if new.status::text = 'paused' then
        new.paused_at := now();
      end if;
      if new.status::text = 'archived' then
        new.archived_at := now();
      end if;
      if new.status::text = 'active' and old.status::text = 'reserved' then
        new.reserved_at := null;
      end if;
      if new.status::text = 'active' and old.status::text = 'paused' then
        new.paused_at := null;
      end if;
      if new.status::text = 'draft' and old.status::text = 'archived' then
        new.archived_at := null;
      end if;
    end if;
  else
    -- Trusted/admin path: set timestamps consistently
    if new.status::text = 'active' and old.status::text is distinct from 'active' then
      new.published_at := coalesce(new.published_at, old.published_at, now());
      if old.status::text = 'paused' then
        new.paused_at := null;
      end if;
      if old.status::text = 'reserved' then
        new.reserved_at := null;
      end if;
    end if;
    if new.status::text = 'reserved' and old.status::text is distinct from 'reserved' then
      new.reserved_at := coalesce(new.reserved_at, now());
    end if;
    if new.status::text = 'completed' and old.status::text is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if new.status::text = 'paused' and old.status::text is distinct from 'paused' then
      new.paused_at := coalesce(new.paused_at, now());
    end if;
    if new.status::text = 'archived' and old.status::text is distinct from 'archived' then
      new.archived_at := coalesce(new.archived_at, now());
    end if;
  end if;

  -- Anti-spam for services when becoming active or changing title while active
  if new.listing_type = 'service'
     and new.status::text = 'active'
     and (
       old.status::text is distinct from 'active'
       or new.title is distinct from old.title
       or new.publisher_type is distinct from old.publisher_type
       or new.publisher_business_id is distinct from old.publisher_business_id
     )
  then
    select d.service_category_id into svc_cat
    from public.service_listing_details d
    where d.listing_id = new.id;

    if new.publisher_type = 'profile' then
      select count(*) into n_active
      from public.listings l
      where l.owner_id = new.owner_id
        and l.publisher_type = 'profile'
        and l.listing_type = 'service'
        and l.status::text = 'active'
        and l.id is distinct from new.id;
      if n_active >= 10 then
        raise exception 'maximum 10 active service listings per profile' using errcode = 'P0001';
      end if;
    elsif new.publisher_type = 'business' then
      select count(*) into n_active
      from public.listings l
      where l.publisher_business_id = new.publisher_business_id
        and l.publisher_type = 'business'
        and l.listing_type = 'service'
        and l.status::text = 'active'
        and l.id is distinct from new.id;
      if n_active >= 25 then
        raise exception 'maximum 25 active service listings per business' using errcode = 'P0001';
      end if;
    end if;

    -- Duplicate active: same title + category + publisher
    if exists (
      select 1
      from public.listings l
      left join public.service_listing_details d on d.listing_id = l.id
      where l.listing_type = 'service'
        and l.status::text = 'active'
        and l.id is distinct from new.id
        and lower(btrim(l.title)) = lower(btrim(new.title))
        and d.service_category_id is not distinct from svc_cat
        and (
          (new.publisher_type = 'profile'
            and l.publisher_type = 'profile'
            and l.owner_id = new.owner_id)
          or (new.publisher_type = 'business'
            and l.publisher_type = 'business'
            and l.publisher_business_id = new.publisher_business_id)
        )
    ) then
      raise exception 'duplicate active service listing for title and category' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.listings_enforce_row() from public, anon, authenticated;

-- Catalog views: owner-definer so resolve_listing_publisher can read owner_id
-- without granting owner_id SELECT to anon.
drop view if exists public.marketplace_catalog cascade;
drop view if exists public.services_catalog cascade;

create view public.marketplace_catalog as
select
  l.id,
  l.title,
  l.description,
  l.price_amount,
  l.price_currency,
  l.is_negotiable,
  l.city,
  l.state,
  l.author_visibility,
  l.published_at,
  l.updated_at,
  l.favorites_count,
  l.publisher_type,
  d.category_id,
  d.condition,
  d.transaction_type,
  c.slug as category_slug,
  c.name_ru as category_name_ru,
  public.resolve_listing_publisher(
    l.publisher_type,
    l.publisher_business_id,
    l.owner_id,
    l.author_visibility
  ) as publisher
from public.listings l
join public.marketplace_listing_details d on d.listing_id = l.id
left join public.listing_categories c on c.id = d.category_id
where l.listing_type = 'marketplace_item'
  and l.status::text = 'active'
  and l.visibility = 'public';

revoke all on public.marketplace_catalog from public;
grant select on public.marketplace_catalog to anon, authenticated;

create view public.services_catalog as
select
  l.id,
  l.title,
  l.description,
  l.price_amount,
  l.price_currency,
  l.is_negotiable,
  l.city,
  l.state,
  l.author_visibility,
  l.published_at,
  l.updated_at,
  l.favorites_count,
  l.publisher_type,
  s.service_category_id,
  s.pricing_type,
  s.price_from,
  s.price_to,
  s.price_unit,
  s.service_modes,
  s.service_area,
  s.experience_years,
  s.languages,
  s.offers_free_estimate,
  s.offers_emergency_service,
  c.slug as category_slug,
  c.name_ru as category_name_ru,
  public.resolve_listing_publisher(
    l.publisher_type,
    l.publisher_business_id,
    l.owner_id,
    l.author_visibility
  ) as publisher
from public.listings l
join public.service_listing_details s on s.listing_id = l.id
left join public.listing_categories c on c.id = s.service_category_id
where l.listing_type = 'service'
  and l.status::text = 'active'
  and l.visibility = 'public';

revoke all on public.services_catalog from public;
grant select on public.services_catalog to anon, authenticated;
