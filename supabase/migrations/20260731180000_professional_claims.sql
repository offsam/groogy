-- Professional ownership claims (mirror of business_claims).
-- Approve sets professionals.owner_profile_id for the claimant.

create table if not exists public.professional_claims (
  id                   uuid primary key default gen_random_uuid(),
  professional_id      uuid not null references public.professionals(id) on delete cascade,
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

create unique index if not exists professional_claims_one_pending_idx
  on public.professional_claims (professional_id, user_id)
  where status = 'pending';

create index if not exists professional_claims_professional_idx
  on public.professional_claims (professional_id);

create index if not exists professional_claims_user_idx
  on public.professional_claims (user_id);

create trigger professional_claims_set_updated_at
  before update on public.professional_claims
  for each row
  execute function public.set_updated_at();

alter table public.professional_claims enable row level security;

grant select on public.professional_claims to authenticated;

create policy "users can create own professional claims"
  on public.professional_claims
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and moderator_note is null
  );

create policy "users can read own professional claims"
  on public.professional_claims
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "users can cancel own pending professional claims"
  on public.professional_claims
  for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'cancelled');

revoke all on public.professional_claims from anon;
revoke insert, update on public.professional_claims from authenticated;
grant insert (
  professional_id,
  user_id,
  verification_method,
  verification_details,
  applicant_message
) on public.professional_claims to authenticated;
grant update (status) on public.professional_claims to authenticated;

-- ============ Admin list ============
create or replace function public.admin_list_pending_professional_claims()
returns table (
  id uuid,
  professional_id uuid,
  professional_slug text,
  professional_name text,
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
    c.professional_id,
    p.slug as professional_slug,
    p.display_name as professional_name,
    c.user_id,
    pr.display_name as applicant_display_name,
    au.email::text as applicant_email,
    c.verification_method,
    c.verification_details,
    c.applicant_message,
    c.created_at
  from public.professional_claims c
  join public.professionals p on p.id = c.professional_id
  left join public.profiles pr on pr.id = c.user_id
  left join auth.users au on au.id = c.user_id
  where c.status = 'pending'
  order by c.created_at asc;
end;
$$;

revoke all on function public.admin_list_pending_professional_claims() from public, anon;
grant execute on function public.admin_list_pending_professional_claims() to authenticated;

-- ============ Admin review ============
create or replace function public.admin_review_professional_claim(
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
  v_claim public.professional_claims%rowtype;
  v_current_owner uuid;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = 'P0001';
  end if;

  select * into v_claim
  from public.professional_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception 'claim not found' using errcode = 'P0001';
  end if;

  if v_claim.status is distinct from 'pending' then
    raise exception 'claim is not pending' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    select owner_profile_id into v_current_owner
    from public.professionals
    where id = v_claim.professional_id
    for update;

    if not found then
      raise exception 'professional not found' using errcode = 'P0001';
    end if;

    if v_current_owner is not null
       and v_current_owner is distinct from v_claim.user_id then
      raise exception 'already claimed' using errcode = 'P0001';
    end if;

    if exists (
      select 1
      from public.professionals
      where owner_profile_id = v_claim.user_id
        and id is distinct from v_claim.professional_id
    ) then
      raise exception 'user already owns a professional' using errcode = 'P0001';
    end if;

    update public.professionals
    set
      owner_profile_id = v_claim.user_id,
      updated_at = now()
    where id = v_claim.professional_id;
  end if;

  update public.professional_claims
  set
    status = p_decision::public.business_claim_status,
    moderator_note = nullif(btrim(coalesce(p_moderator_note, '')), ''),
    reviewed_by = v_caller,
    reviewed_at = now(),
    updated_at = now()
  where id = p_claim_id;

  perform public.emit_domain_event(
    'professional.claim_' || p_decision,
    'professional',
    v_claim.professional_id,
    jsonb_build_object('claim_id', p_claim_id, 'user_id', v_claim.user_id)
  );
end;
$$;

revoke all on function public.admin_review_professional_claim(uuid, text, text) from public, anon;
grant execute on function public.admin_review_professional_claim(uuid, text, text) to authenticated;
