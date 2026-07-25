-- Admin review of business ownership claims.
-- Approving inserts business_owners and marks the claim approved.
-- Rejecting marks the claim rejected with an optional note.

create or replace function public.admin_list_pending_business_claims()
returns table (
  id uuid,
  business_id uuid,
  business_slug text,
  business_name text,
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
    c.business_id,
    b.slug as business_slug,
    b.name as business_name,
    c.user_id,
    p.display_name as applicant_display_name,
    au.email::text as applicant_email,
    c.verification_method,
    c.verification_details,
    c.applicant_message,
    c.created_at
  from public.business_claims c
  join public.businesses b on b.id = c.business_id
  left join public.profiles p on p.id = c.user_id
  left join auth.users au on au.id = c.user_id
  where c.status = 'pending'
  order by c.created_at asc;
end;
$$;

revoke all on function public.admin_list_pending_business_claims() from public, anon;
grant execute on function public.admin_list_pending_business_claims() to authenticated;

create or replace function public.admin_review_business_claim(
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
  v_claim public.business_claims%rowtype;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = 'P0001';
  end if;

  select * into v_claim
  from public.business_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception 'claim not found' using errcode = 'P0001';
  end if;

  if v_claim.status is distinct from 'pending' then
    raise exception 'claim is not pending' using errcode = 'P0001';
  end if;

  if p_decision = 'approved' then
    insert into public.business_owners (business_id, user_id, role)
    values (v_claim.business_id, v_claim.user_id, 'owner')
    on conflict (business_id, user_id) do nothing;

    -- Prefer owner role on profile when still a plain user.
    perform set_config('app.allow_role_change', '1', true);
    update public.profiles
    set role = 'business_owner', updated_at = now()
    where id = v_claim.user_id
      and role = 'user';
  end if;

  update public.business_claims
  set
    status = p_decision::public.business_claim_status,
    moderator_note = nullif(btrim(coalesce(p_moderator_note, '')), ''),
    reviewed_by = v_caller,
    reviewed_at = now(),
    updated_at = now()
  where id = p_claim_id;
end;
$$;

revoke all on function public.admin_review_business_claim(uuid, text, text) from public, anon;
grant execute on function public.admin_review_business_claim(uuid, text, text) to authenticated;
