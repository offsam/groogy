-- Allow trusted (service-role) listing inserts without auth.uid().
-- Direct PostgREST inserts still require a SECURITY DEFINER RPC that enables
-- private.trusted listing write in the same transaction.

create or replace function public.listings_enforce_row()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
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
      if not trusted then
        raise exception 'authentication required' using errcode = '42501';
      end if;
      if new.owner_id is null then
        raise exception 'owner_id required for trusted listing insert' using errcode = 'P0001';
      end if;
    else
      new.owner_id := uid;
    end if;

    new.favorites_count := 0;
    new.moderation_reason := null;
    if not trusted then
      new.published_at := null;
    else
      -- Keep caller-provided published_at for elevated/autopublish inserts.
      new.published_at := coalesce(new.published_at, case when new.status::text = 'active' then now() else null end);
    end if;
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

      select count(*) into n_creates
      from public.review_abuse_events e
      where e.user_id = uid
        and e.kind = 'listing_create'
        and e.created_at > now() - interval '1 hour';
      if n_creates >= 20 then
        raise exception 'listing create rate limit exceeded' using errcode = 'P0001';
      end if;
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

    new.title := btrim(new.title);
    new.description := btrim(new.description);
    if new.city is not null then new.city := btrim(new.city); end if;
    if new.state is not null then new.state := btrim(new.state); end if;
    return new;
  end if;

  -- UPDATE path unchanged from prior definition (trusted/user transitions).
  new.owner_id := old.owner_id;
  new.listing_type := old.listing_type;
  new.created_at := old.created_at;
  new.favorites_count := old.favorites_count;
  new.title := btrim(new.title);
  new.description := btrim(new.description);
  if new.city is not null then new.city := btrim(new.city); end if;
  if new.state is not null then new.state := btrim(new.state); end if;

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
    new.moderation_reason := old.moderation_reason;
    new.published_at := old.published_at;
    new.reserved_at := old.reserved_at;
    new.completed_at := old.completed_at;
    new.paused_at := old.paused_at;
    new.archived_at := old.archived_at;
    new.expires_at := old.expires_at;

    if new.status::text in ('removed', 'rejected', 'expired') then
      raise exception 'status transition not allowed' using errcode = 'P0001';
    end if;
    if old.status::text in ('removed', 'rejected') then
      raise exception 'cannot modify moderated listing' using errcode = 'P0001';
    end if;

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

-- One-shot RPC for import-review autopublish (marketplace / real_estate).
create or replace function public.service_autopublish_marketplace_listing(
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_price_amount numeric default null,
  p_price_currency text default 'USD',
  p_city text default null,
  p_state text default null,
  p_published_at timestamptz default null,
  p_condition text default 'good',
  p_transaction_type text default 'sell'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
  v_cat uuid;
begin
  if p_owner_id is null then
    raise exception 'owner_id required' using errcode = 'P0001';
  end if;

  -- Prefer any active marketplace listing category when available.
  select id into v_cat
  from public.listing_categories
  where listing_type = 'marketplace_item'
    and is_active = true
  order by sort_order
  limit 1;

  perform private.enable_trusted_listing_write();
  begin
    insert into public.listings (
      owner_id,
      listing_type,
      status,
      visibility,
      title,
      description,
      price_amount,
      price_currency,
      city,
      state,
      publisher_type,
      published_at
    ) values (
      p_owner_id,
      'marketplace_item',
      'active',
      'public',
      btrim(p_title),
      btrim(p_description),
      p_price_amount,
      coalesce(nullif(btrim(p_price_currency), ''), 'USD'),
      nullif(btrim(coalesce(p_city, '')), ''),
      coalesce(nullif(btrim(coalesce(p_state, '')), ''), 'CA'),
      'profile',
      coalesce(p_published_at, now())
    )
    returning id into v_id;

    insert into public.marketplace_listing_details (
      listing_id, condition, transaction_type, category_id
    ) values (
      v_id,
      coalesce(nullif(btrim(p_condition), ''), 'good')::listing_condition,
      coalesce(nullif(btrim(p_transaction_type), ''), 'sell')::listing_transaction_type,
      v_cat
    );

    perform private.disable_trusted_listing_write();
  exception when others then
    perform private.disable_trusted_listing_write();
    raise;
  end;

  return v_id;
end;
$$;

revoke all on function public.service_autopublish_marketplace_listing(
  uuid, text, text, numeric, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.service_autopublish_marketplace_listing(
  uuid, text, text, numeric, text, text, text, timestamptz, text, text
) to service_role;
