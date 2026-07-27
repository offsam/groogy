-- D1 (ARCHITECTURE_ALIGNMENT_ROADMAP P-1): imported cards are unowned-until-
-- claimed, like unclaimed businesses.
-- 1) listings.owner_id becomes nullable (the insert RLS policy has allowed
--    owner_id IS NULL since day one — the constraint made that branch dead);
-- 2) listings_enforce_row lets ADMINS insert with owner_id null (imported
--    cards); non-admin inserts are still forced to self-ownership, and
--    owner_id stays immutable on UPDATE (future transfer = dedicated RPC);
-- 3) backfill releases admin-held ownership of queue-imported rows (the
--    approving admin remains in import_review_audit / approved_by).

alter table public.listings alter column owner_id drop not null;

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
      -- D1 (ARCHITECTURE_ALIGNMENT_ROADMAP P-1): admins may create UNOWNED
      -- (imported) listings — vacant until claimed. Everyone else is always
      -- forced to own what they insert.
      if new.owner_id is null and public.is_admin() then
        null;
      else
        new.owner_id := uid;
      end if;
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


-- Backfill: enforce trigger makes owner_id immutable on UPDATE — disable it
-- for this one statement (single transaction, additive data release).
alter table public.listings disable trigger listings_enforce_row;

update public.listings
set owner_id = null
where source_kind in ('telegram', 'facebook')
  and owner_id is not null;

alter table public.listings enable trigger listings_enforce_row;

update public.jobs
set owner_profile_id = null
where source_type in ('TELEGRAM', 'FACEBOOK', 'IMPORT')
  and imported_at is not null
  and owner_profile_id is not null;
