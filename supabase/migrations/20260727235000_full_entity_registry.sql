-- C1 (ARCHITECTURE_ALIGNMENT_ROADMAP): full entities registry.
-- Extends the professionals/jobs sync pattern to businesses, events and
-- listings, then backfills — every published object gets an address in the
-- single namespace (closes V-7 / P-5). Additive only.
--
-- Listing kinds mapped to registry entity_type:
--   marketplace_item → marketplace_item, job → job, vehicle → vehicle,
--   transfer → transfer, transport_carry → lechu.
--   'service' and 'resume' listing types are deliberately NOT registered:
--   the registry enum has no such kinds — service listings are the offer
--   surface of a professional/business card, not standalone ecosystem
--   objects (see CORE_DOMAIN / ENTITY_TYPE_MAPPING).

-- ============ fix: outbox grants for the consumer role (B2) ============
-- The stabilization migration revoked broadly; service_role needs read +
-- processed_at stamping to run consume_domain_events.py.
grant select, update (processed_at) on public.domain_events to service_role;

-- ============ businesses ============
create or replace function public.trg_sync_entity_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.entities_delete_by_source('business', old.id);
    return old;
  end if;
  perform public.entities_upsert(
    'business',
    new.id,
    case new.status
      when 'approved' then 'published'::public.entity_registry_status
      when 'pending' then 'pending'::public.entity_registry_status
      when 'draft' then 'draft'::public.entity_registry_status
      when 'rejected' then 'rejected'::public.entity_registry_status
      when 'archived' then 'archived'::public.entity_registry_status
      when 'deferred' then 'hidden'::public.entity_registry_status
      else 'draft'::public.entity_registry_status
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_business on public.businesses;
create trigger trg_sync_entity_business
  after insert or update of status or delete
  on public.businesses
  for each row execute function public.trg_sync_entity_business();

-- ============ events ============
create or replace function public.trg_sync_entity_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.entities_delete_by_source('event', old.id);
    return old;
  end if;
  perform public.entities_upsert(
    'event',
    new.id,
    case new.status
      when 'published' then 'published'::public.entity_registry_status
      when 'draft' then 'draft'::public.entity_registry_status
      when 'archived' then 'archived'::public.entity_registry_status
      else 'draft'::public.entity_registry_status
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_event on public.events;
create trigger trg_sync_entity_event
  after insert or update of status or delete
  on public.events
  for each row execute function public.trg_sync_entity_event();

-- ============ listings (registry-kind types only) ============
create or replace function public.listing_registry_kind(p_listing_type public.listing_type)
returns public.entity_type
language sql
immutable
as $$
  select case p_listing_type::text
    when 'marketplace_item' then 'marketplace_item'::public.entity_type
    when 'job' then 'job'::public.entity_type
    when 'vehicle' then 'vehicle'::public.entity_type
    when 'transfer' then 'transfer'::public.entity_type
    when 'transport_carry' then 'lechu'::public.entity_type
    else null
  end;
$$;

create or replace function public.listing_registry_status(p_status public.listing_status)
returns public.entity_registry_status
language sql
immutable
as $$
  select case p_status::text
    when 'draft' then 'draft'::public.entity_registry_status
    when 'active' then 'published'::public.entity_registry_status
    when 'paused' then 'hidden'::public.entity_registry_status
    when 'reserved' then 'hidden'::public.entity_registry_status
    when 'completed' then 'archived'::public.entity_registry_status
    when 'expired' then 'archived'::public.entity_registry_status
    when 'archived' then 'archived'::public.entity_registry_status
    when 'removed' then 'archived'::public.entity_registry_status
    when 'rejected' then 'rejected'::public.entity_registry_status
    else 'draft'::public.entity_registry_status
  end;
$$;

create or replace function public.trg_sync_entity_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind public.entity_type;
begin
  if tg_op = 'DELETE' then
    v_kind := public.listing_registry_kind(old.listing_type);
    if v_kind is not null then
      perform public.entities_delete_by_source(v_kind, old.id);
    end if;
    return old;
  end if;
  v_kind := public.listing_registry_kind(new.listing_type);
  if v_kind is not null then
    perform public.entities_upsert(
      v_kind, new.id, public.listing_registry_status(new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_listing on public.listings;
create trigger trg_sync_entity_listing
  after insert or update of status or delete
  on public.listings
  for each row execute function public.trg_sync_entity_listing();

-- ============ backfill ============
select public.entities_upsert(
  'business', b.id,
  case b.status
    when 'approved' then 'published'::public.entity_registry_status
    when 'pending' then 'pending'::public.entity_registry_status
    when 'draft' then 'draft'::public.entity_registry_status
    when 'rejected' then 'rejected'::public.entity_registry_status
    when 'archived' then 'archived'::public.entity_registry_status
    when 'deferred' then 'hidden'::public.entity_registry_status
    else 'draft'::public.entity_registry_status
  end
) from public.businesses b;

select public.entities_upsert(
  'event', e.id,
  case e.status
    when 'published' then 'published'::public.entity_registry_status
    when 'draft' then 'draft'::public.entity_registry_status
    when 'archived' then 'archived'::public.entity_registry_status
    else 'draft'::public.entity_registry_status
  end
) from public.events e;

select public.entities_upsert(
  public.listing_registry_kind(l.listing_type), l.id,
  public.listing_registry_status(l.status)
) from public.listings l
where public.listing_registry_kind(l.listing_type) is not null;
