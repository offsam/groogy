-- PACK 2.7 business offers RLS suite (remote). Single transaction; ROLLBACK.

begin;

do $$
declare
  v_cat uuid := gen_random_uuid();
  v_biz uuid := gen_random_uuid();
  v_biz2 uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_anon uuid := gen_random_uuid();
  v_offer_pub uuid;
  v_offer_draft uuid;
  n int;
  passed int := 0;
begin
  insert into public.categories (id, slug, name, sort_order, is_active)
  values (v_cat, 'off-' || substr(v_biz::text, 1, 8), 'Offer Cat', 999, true);

  insert into public.businesses (id, slug, category_id, name, status)
  values
    (v_biz, 'off-biz-' || substr(v_biz::text, 1, 8), v_cat, 'Offer Biz', 'approved'),
    (v_biz2, 'off-biz2-' || substr(v_biz2::text, 1, 8), v_cat, 'Offer Biz 2', 'approved');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous)
  values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'offown-'||substr(v_owner::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'offoth-'||substr(v_other::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false, false, false);

  insert into public.profiles (id, display_name, role) values
    (v_owner, 'Owner', 'business_owner'),
    (v_other, 'Other', 'user')
  on conflict (id) do update set role = excluded.role;

  insert into public.business_owners (business_id, user_id, role)
  values (v_biz, v_owner, 'owner');

  -- seed offers as postgres (bypass owner trigger)
  insert into public.business_offers (
    business_id, offer_type, title, slug, status, visibility, price_mode, price_amount, currency, published_at
  ) values
    (v_biz, 'service', 'Public Svc', 'public-svc', 'active', 'public', 'fixed', 99, 'USD', now())
  returning id into v_offer_pub;

  insert into public.business_offers (
    business_id, offer_type, title, slug, status, visibility, price_mode
  ) values
    (v_biz, 'service', 'Draft Svc', 'draft-svc', 'draft', 'public', 'contact')
  returning id into v_offer_draft;

  -- anon: only active public from test business
  reset role;
  set local role anon;
  select count(*) into n from public.business_offers where business_id = v_biz;
  if n <> 1 then raise exception 'FAIL anon_count: expected 1 got %', n; end if;
  passed := passed + 1;

  select count(*) into n from public.business_offers where id = v_offer_draft;
  if n <> 0 then raise exception 'FAIL anon_draft_hidden'; end if;
  passed := passed + 1;

  -- owner sees both
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.business_offers where business_id = v_biz;
  if n <> 2 then raise exception 'FAIL owner_count: %', n; end if;
  passed := passed + 1;

  -- other user cannot insert for foreign business
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  begin
    insert into public.business_offers (business_id, offer_type, title, slug, price_mode)
    values (v_biz, 'service', 'Hack', 'hack', 'contact');
    raise exception 'FAIL other_insert_allowed';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  -- archived business hides its offers from anon
  reset role;
  update public.businesses set status = 'archived' where id = v_biz;
  reset role;
  set local role anon;
  select count(*) into n from public.business_offers where business_id = v_biz;
  if n <> 0 then raise exception 'FAIL archived_business_hidden: %', n; end if;
  passed := passed + 1;

  raise notice 'BUSINESS OFFERS RLS: %/% PASSED', passed, passed;
end $$;

rollback;
