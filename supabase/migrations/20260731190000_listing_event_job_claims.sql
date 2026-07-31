-- Claim flows for listings (marketplace/services/transfers/lechu), events, jobs.
-- Listings: owner_id is immutable via listings_enforce_row — claim assign
-- temporarily disables that trigger (same pattern as vacant-owner backfill).

-- ============ listing_claims ============
create table if not exists public.listing_claims (
  id                   uuid primary key default gen_random_uuid(),
  listing_id           uuid not null references public.listings(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  status               public.business_claim_status not null default 'pending',
  verification_method  text,
  verification_details text,
  applicant_message    text,
  moderator_note       text,
  reviewed_by          uuid references auth.users(id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists listing_claims_one_pending_idx
  on public.listing_claims (listing_id, user_id)
  where status = 'pending';

create index if not exists listing_claims_listing_idx on public.listing_claims (listing_id);
create index if not exists listing_claims_user_idx on public.listing_claims (user_id);

create trigger listing_claims_set_updated_at
  before update on public.listing_claims
  for each row execute function public.set_updated_at();

alter table public.listing_claims enable row level security;
grant select on public.listing_claims to authenticated;

create policy "users can create own listing claims"
  on public.listing_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and moderator_note is null
  );

create policy "users can read own listing claims"
  on public.listing_claims for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users can cancel own pending listing claims"
  on public.listing_claims for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'cancelled');

revoke all on public.listing_claims from anon;
revoke insert, update on public.listing_claims from authenticated;
grant insert (listing_id, user_id, verification_method, verification_details, applicant_message)
  on public.listing_claims to authenticated;
grant update (status) on public.listing_claims to authenticated;

-- ============ event_claims ============
create table if not exists public.event_claims (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  status               public.business_claim_status not null default 'pending',
  verification_method  text,
  verification_details text,
  applicant_message    text,
  moderator_note       text,
  reviewed_by          uuid references auth.users(id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists event_claims_one_pending_idx
  on public.event_claims (event_id, user_id)
  where status = 'pending';

create index if not exists event_claims_event_idx on public.event_claims (event_id);
create index if not exists event_claims_user_idx on public.event_claims (user_id);

create trigger event_claims_set_updated_at
  before update on public.event_claims
  for each row execute function public.set_updated_at();

alter table public.event_claims enable row level security;
grant select on public.event_claims to authenticated;

create policy "users can create own event claims"
  on public.event_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and moderator_note is null
  );

create policy "users can read own event claims"
  on public.event_claims for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users can cancel own pending event claims"
  on public.event_claims for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'cancelled');

revoke all on public.event_claims from anon;
revoke insert, update on public.event_claims from authenticated;
grant insert (event_id, user_id, verification_method, verification_details, applicant_message)
  on public.event_claims to authenticated;
grant update (status) on public.event_claims to authenticated;

-- ============ job_claims ============
create table if not exists public.job_claims (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.jobs(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  status               public.business_claim_status not null default 'pending',
  verification_method  text,
  verification_details text,
  applicant_message    text,
  moderator_note       text,
  reviewed_by          uuid references auth.users(id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists job_claims_one_pending_idx
  on public.job_claims (job_id, user_id)
  where status = 'pending';

create index if not exists job_claims_job_idx on public.job_claims (job_id);
create index if not exists job_claims_user_idx on public.job_claims (user_id);

create trigger job_claims_set_updated_at
  before update on public.job_claims
  for each row execute function public.set_updated_at();

alter table public.job_claims enable row level security;
grant select on public.job_claims to authenticated;

create policy "users can create own job claims"
  on public.job_claims for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and moderator_note is null
  );

create policy "users can read own job claims"
  on public.job_claims for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users can cancel own pending job claims"
  on public.job_claims for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'cancelled');

revoke all on public.job_claims from anon;
revoke insert, update on public.job_claims from authenticated;
grant insert (job_id, user_id, verification_method, verification_details, applicant_message)
  on public.job_claims to authenticated;
grant update (status) on public.job_claims to authenticated;

-- ============ Assign listing owner (bypass immutable owner_id trigger) ============
create or replace function public.assign_listing_owner_on_claim(
  p_listing_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated int;
begin
  alter table public.listings disable trigger listings_enforce_row;
  begin
    update public.listings
    set
      owner_id = p_user_id,
      updated_at = now()
    where id = p_listing_id
      and owner_id is null;
    get diagnostics v_updated = row_count;
  exception
    when others then
      alter table public.listings enable trigger listings_enforce_row;
      raise;
  end;
  alter table public.listings enable trigger listings_enforce_row;

  if v_updated = 0 then
    raise exception 'already claimed or not found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assign_listing_owner_on_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_listing_owner_on_claim(uuid, uuid) to service_role;

-- ============ Admin list / review: listings ============
create or replace function public.admin_list_pending_listing_claims()
returns table (
  id uuid,
  listing_id uuid,
  listing_type text,
  listing_title text,
  user_id uuid,
  applicant_display_name text,
  applicant_email text,
  verification_method text,
  verification_details text,
  applicant_message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.listing_id,
    l.listing_type::text,
    l.title,
    c.user_id,
    p.display_name,
    au.email::text,
    c.verification_method,
    c.verification_details,
    c.applicant_message,
    c.created_at
  from public.listing_claims c
  join public.listings l on l.id = c.listing_id
  left join public.profiles p on p.id = c.user_id
  left join auth.users au on au.id = c.user_id
  where c.status = 'pending'
  order by c.created_at asc;
end;
$$;

revoke all on function public.admin_list_pending_listing_claims() from public, anon;
grant execute on function public.admin_list_pending_listing_claims() to authenticated;

create or replace function public.admin_review_listing_claim(
  p_claim_id uuid,
  p_decision text,
  p_moderator_note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
  v_claim public.listing_claims%rowtype;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = 'P0001';
  end if;

  select * into v_claim from public.listing_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0001';
  end if;
  if v_claim.status is distinct from 'pending' then
    raise exception 'claim is not pending' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    perform public.assign_listing_owner_on_claim(v_claim.listing_id, v_claim.user_id);
  end if;

  update public.listing_claims
  set
    status = p_decision::public.business_claim_status,
    moderator_note = nullif(btrim(coalesce(p_moderator_note, '')), ''),
    reviewed_by = v_caller,
    reviewed_at = now(),
    updated_at = now()
  where id = p_claim_id;

  perform public.emit_domain_event(
    'listing.claim_' || p_decision,
    'listing',
    v_claim.listing_id,
    jsonb_build_object('claim_id', p_claim_id, 'user_id', v_claim.user_id)
  );
end;
$$;

revoke all on function public.admin_review_listing_claim(uuid, text, text) from public, anon;
grant execute on function public.admin_review_listing_claim(uuid, text, text) to authenticated;

-- ============ Admin list / review: events ============
create or replace function public.admin_list_pending_event_claims()
returns table (
  id uuid,
  event_id uuid,
  event_slug text,
  event_title text,
  user_id uuid,
  applicant_display_name text,
  applicant_email text,
  verification_method text,
  verification_details text,
  applicant_message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.event_id,
    e.slug,
    e.title,
    c.user_id,
    p.display_name,
    au.email::text,
    c.verification_method,
    c.verification_details,
    c.applicant_message,
    c.created_at
  from public.event_claims c
  join public.events e on e.id = c.event_id
  left join public.profiles p on p.id = c.user_id
  left join auth.users au on au.id = c.user_id
  where c.status = 'pending'
  order by c.created_at asc;
end;
$$;

revoke all on function public.admin_list_pending_event_claims() from public, anon;
grant execute on function public.admin_list_pending_event_claims() to authenticated;

create or replace function public.admin_review_event_claim(
  p_claim_id uuid,
  p_decision text,
  p_moderator_note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
  v_claim public.event_claims%rowtype;
  v_current_owner uuid;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = 'P0001';
  end if;

  select * into v_claim from public.event_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0001';
  end if;
  if v_claim.status is distinct from 'pending' then
    raise exception 'claim is not pending' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    select owner_profile_id into v_current_owner
    from public.events where id = v_claim.event_id for update;
    if not found then
      raise exception 'event not found' using errcode = 'P0001';
    end if;
    if v_current_owner is not null and v_current_owner is distinct from v_claim.user_id then
      raise exception 'already claimed' using errcode = 'P0001';
    end if;
    update public.events
    set owner_profile_id = v_claim.user_id, updated_at = now()
    where id = v_claim.event_id;
  end if;

  update public.event_claims
  set
    status = p_decision::public.business_claim_status,
    moderator_note = nullif(btrim(coalesce(p_moderator_note, '')), ''),
    reviewed_by = v_caller,
    reviewed_at = now(),
    updated_at = now()
  where id = p_claim_id;

  perform public.emit_domain_event(
    'event.claim_' || p_decision,
    'event',
    v_claim.event_id,
    jsonb_build_object('claim_id', p_claim_id, 'user_id', v_claim.user_id)
  );
end;
$$;

revoke all on function public.admin_review_event_claim(uuid, text, text) from public, anon;
grant execute on function public.admin_review_event_claim(uuid, text, text) to authenticated;

-- ============ Admin list / review: jobs ============
create or replace function public.admin_list_pending_job_claims()
returns table (
  id uuid,
  job_id uuid,
  job_slug text,
  job_title text,
  user_id uuid,
  applicant_display_name text,
  applicant_email text,
  verification_method text,
  verification_details text,
  applicant_message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.job_id,
    j.slug,
    j.title,
    c.user_id,
    p.display_name,
    au.email::text,
    c.verification_method,
    c.verification_details,
    c.applicant_message,
    c.created_at
  from public.job_claims c
  join public.jobs j on j.id = c.job_id
  left join public.profiles p on p.id = c.user_id
  left join auth.users au on au.id = c.user_id
  where c.status = 'pending'
  order by c.created_at asc;
end;
$$;

revoke all on function public.admin_list_pending_job_claims() from public, anon;
grant execute on function public.admin_list_pending_job_claims() to authenticated;

create or replace function public.admin_review_job_claim(
  p_claim_id uuid,
  p_decision text,
  p_moderator_note text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
  v_claim public.job_claims%rowtype;
  v_current_owner uuid;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = 'P0001';
  end if;

  select * into v_claim from public.job_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0001';
  end if;
  if v_claim.status is distinct from 'pending' then
    raise exception 'claim is not pending' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    select owner_profile_id into v_current_owner
    from public.jobs where id = v_claim.job_id for update;
    if not found then
      raise exception 'job not found' using errcode = 'P0001';
    end if;
    if v_current_owner is not null and v_current_owner is distinct from v_claim.user_id then
      raise exception 'already claimed' using errcode = 'P0001';
    end if;
    update public.jobs
    set owner_profile_id = v_claim.user_id, updated_at = now()
    where id = v_claim.job_id;
  end if;

  update public.job_claims
  set
    status = p_decision::public.business_claim_status,
    moderator_note = nullif(btrim(coalesce(p_moderator_note, '')), ''),
    reviewed_by = v_caller,
    reviewed_at = now(),
    updated_at = now()
  where id = p_claim_id;

  perform public.emit_domain_event(
    'job.claim_' || p_decision,
    'job',
    v_claim.job_id,
    jsonb_build_object('claim_id', p_claim_id, 'user_id', v_claim.user_id)
  );
end;
$$;

revoke all on function public.admin_review_job_claim(uuid, text, text) from public, anon;
grant execute on function public.admin_review_job_claim(uuid, text, text) to authenticated;
