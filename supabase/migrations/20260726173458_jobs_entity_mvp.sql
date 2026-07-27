-- Jobs entity MVP: one job record for Business page + Jobs hub.
-- business_id set → public attribution to business; NULL → personal.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  source_type text not null default 'USER',
  source_record_id text,
  source_url text,
  imported_at timestamptz,
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  import_batch_id text,
  title text not null,
  slug text not null unique,
  description text,
  employment_type text,
  work_mode text,
  city text,
  state_code text,
  postal_code text,
  compensation_min numeric(12,2),
  compensation_max numeric(12,2),
  compensation_type text,
  status text not null default 'draft',
  visibility text not null default 'public'
    check (visibility in ('public', 'unlisted', 'private')),
  offer_kind public.offer_kind not null default 'hire',
  published_at timestamptz,
  expires_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_offer_kind_chk check (offer_kind in ('hire', 'seek')),
  constraint jobs_status_chk check (
    status in ('draft', 'pending', 'published', 'archived', 'rejected', 'expired')
  ),
  constraint jobs_compensation_range_chk check (
    compensation_min is null
    or compensation_max is null
    or compensation_min <= compensation_max
  ),
  constraint jobs_source_type_chk check (
    source_type in (
      'USER', 'TELEGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'YELP', 'IMPORT', 'ADMIN', 'OTHER'
    )
  )
);

create index if not exists jobs_business_id_idx
  on public.jobs (business_id)
  where business_id is not null;

create index if not exists jobs_created_by_idx
  on public.jobs (created_by_profile_id);

create index if not exists jobs_status_published_idx
  on public.jobs (status, published_at desc)
  where status = 'published';

comment on table public.jobs is
  'Single Job for Business page + /jobs hub — no copies. business_id NOT NULL = business-attributed.';

create or replace function public.jobs_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.created_by_profile_id is distinct from old.created_by_profile_id
       and not public.is_admin() then
      raise exception 'jobs.created_by_profile_id is immutable'
        using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := coalesce(new.published_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists jobs_enforce_row on public.jobs;
create trigger jobs_enforce_row
  before insert or update on public.jobs
  for each row execute function public.jobs_enforce_row();

-- Sync into entities registry when present
create or replace function public.trg_sync_entity_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.entities') is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    perform public.entities_delete_by_source('job', old.id);
    return old;
  end if;
  perform public.entities_upsert(
    'job',
    new.id,
    case new.status
      when 'published' then 'published'::public.entity_registry_status
      when 'pending' then 'pending'::public.entity_registry_status
      when 'draft' then 'draft'::public.entity_registry_status
      when 'rejected' then 'rejected'::public.entity_registry_status
      when 'archived' then 'archived'::public.entity_registry_status
      when 'expired' then 'archived'::public.entity_registry_status
      else 'draft'::public.entity_registry_status
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_sync_entity_job on public.jobs;
create trigger trg_sync_entity_job
  after insert or update of status or delete
  on public.jobs
  for each row execute function public.trg_sync_entity_job();

create or replace function public.can_manage_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.jobs j
      where j.id = p_job_id
        and (
          (
            j.business_id is null
            and (
              j.owner_profile_id = (select auth.uid())
              or j.created_by_profile_id = (select auth.uid())
            )
          )
          or (j.business_id is not null and public.owns_business(j.business_id))
        )
    );
$$;

revoke all on function public.can_manage_job(uuid) from public;
grant execute on function public.can_manage_job(uuid) to authenticated;

alter table public.jobs enable row level security;

revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to anon, authenticated;
grant select, insert, update, delete on public.jobs to authenticated;

drop policy if exists "jobs public read published" on public.jobs;
create policy "jobs public read published"
  on public.jobs for select
  to anon, authenticated
  using (
    (status = 'published' and visibility = 'public')
    or public.can_manage_job(id)
  );

drop policy if exists "jobs insert publish eligible" on public.jobs;
create policy "jobs insert publish eligible"
  on public.jobs for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and (
      created_by_profile_id is null
      or created_by_profile_id = (select auth.uid())
    )
    and (
      public.is_admin()
      or (
        business_id is not null
        and public.owns_business(business_id)
      )
      or (
        business_id is null
        and (
          owner_profile_id = (select auth.uid())
          or owner_profile_id is null
        )
        and public.can_publish()
      )
    )
  );

drop policy if exists "jobs update managers" on public.jobs;
create policy "jobs update managers"
  on public.jobs for update
  to authenticated
  using (public.can_manage_job(id))
  with check (
    public.can_manage_job(id)
    and (
      public.is_admin()
      or business_id is null
      or public.owns_business(business_id)
    )
  );

drop policy if exists "jobs delete managers" on public.jobs;
create policy "jobs delete managers"
  on public.jobs for delete
  to authenticated
  using (public.can_manage_job(id));
