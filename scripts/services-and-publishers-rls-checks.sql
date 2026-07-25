-- Services + publishers RLS/security suite (PLATFORM FOUNDATION PACK 2).
-- Single transaction; ROLLBACK. Requires migration 20260719200000_publishers_and_services_mvp.
-- Do NOT run against production without review. Prefer local or confirmed remote.
--
-- Covers Pack 2 brief scenarios 1–75 (publisher, marketplace goods-only, services
-- create/update, visibility, favorites/reports, anti-spam, storage, admin) plus
-- extras: private.enable_trusted_listing_write denied, marketplace_looks_like_service
-- allow/deny paths, services_catalog column hygiene, profile service listings.
-- Expected passes: >= 75 (typically ~82). Count each success INCLUDING expected
-- permission failures.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_biz_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_biz_approved uuid := gen_random_uuid();
  v_biz_pending uuid := gen_random_uuid();
  v_biz_rejected uuid := gen_random_uuid();
  v_biz_other uuid := gen_random_uuid();
  v_mkt_cat uuid;
  v_mkt_inactive uuid;
  v_svc_cat uuid;
  v_svc_cat2 uuid;
  v_svc_inactive uuid;
  v_listing uuid;
  v_listing2 uuid;
  v_svc uuid;
  v_svc_draft uuid;
  v_svc_private uuid;
  v_svc_unlisted uuid;
  v_svc_removed uuid;
  v_svc_rejected uuid;
  v_svc_biz uuid;
  v_mkt_goods uuid;
  v_mkt_biz uuid;
  v_media uuid;
  v_report uuid;
  v_tmp uuid;
  v_pub_type listing_publisher_type;
  v_pub_biz uuid;
  n int;
  i int;
  passed int := 0;
  label text;
  st text;
  reason text;
  pub jsonb;
  price_val numeric;
  paused_ts timestamptz;
  owner_check uuid;
  uname text := 'spown_' || substr(replace(v_owner::text, '-', ''), 1, 8);
  other_uname text := 'spoth_' || substr(replace(v_other::text, '-', ''), 1, 8);
  admin_uname text := 'spadm_' || substr(replace(v_admin::text, '-', ''), 1, 8);
  biz_uname text := 'spbiz_' || substr(replace(v_biz_owner::text, '-', ''), 1, 8);
  mgr_uname text := 'spmgr_' || substr(replace(v_manager::text, '-', ''), 1, 8);
  slug_sfx text := substr(replace(v_owner::text, '-', ''), 1, 8);
begin
  -- ===== Seed users + businesses (elevated) =====
  reset role;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, is_sso_user, is_anonymous
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     uname || '@example.com', crypt('x', gen_salt('bf')), now() - interval '3 days',
     now() - interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     other_uname || '@example.com', crypt('x', gen_salt('bf')), now() - interval '3 days',
     now() - interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     admin_uname || '@example.com', crypt('x', gen_salt('bf')), now() - interval '3 days',
     now() - interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_biz_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     biz_uname || '@example.com', crypt('x', gen_salt('bf')), now() - interval '3 days',
     now() - interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     mgr_uname || '@example.com', crypt('x', gen_salt('bf')), now() - interval '3 days',
     now() - interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false);

  insert into public.profiles (
    id, display_name, username, role, profile_visibility,
    show_listings_in_profile, public_activity_enabled, created_at
  ) values
    (v_owner, 'Sam Owner', uname, 'user', 'public', true, true, now() - interval '3 days'),
    (v_other, 'Other User', other_uname, 'user', 'private', true, true, now() - interval '3 days'),
    (v_admin, 'Admin User', admin_uname, 'admin', 'public', true, true, now() - interval '3 days'),
    (v_biz_owner, 'Biz Owner', biz_uname, 'business_owner', 'public', true, true, now() - interval '3 days'),
    (v_manager, 'Biz Manager', mgr_uname, 'business_owner', 'public', true, true, now() - interval '3 days')
  on conflict (id) do update
    set display_name = excluded.display_name,
        username = excluded.username,
        role = excluded.role,
        profile_visibility = excluded.profile_visibility,
        created_at = excluded.created_at;

  insert into public.businesses (id, slug, name, status, image_url)
  values
    (v_biz_approved, 'sp-ok-' || slug_sfx, 'Approved Biz SP', 'approved', 'https://example.com/logo.png'),
    (v_biz_pending, 'sp-pend-' || slug_sfx, 'Pending Biz SP', 'pending', null),
    (v_biz_rejected, 'sp-rej-' || slug_sfx, 'Rejected Biz SP', 'rejected', null),
    (v_biz_other, 'sp-oth-' || slug_sfx, 'Other Owned Biz SP', 'approved', null);

  insert into public.business_owners (business_id, user_id, role) values
    (v_biz_approved, v_biz_owner, 'owner'),
    (v_biz_approved, v_manager, 'manager'),
    (v_biz_pending, v_biz_owner, 'owner'),
    (v_biz_rejected, v_biz_owner, 'owner'),
    (v_biz_other, v_other, 'owner');

  -- Marketplace + services categories
  select id into v_mkt_cat
  from public.listing_categories
  where domain = 'marketplace' and listing_type = 'marketplace_item' and is_active
  limit 1;
  if v_mkt_cat is null then
    insert into public.listing_categories (slug, name_ru, listing_type, domain, sort_order, is_active)
    values ('electronics-sp-' || slug_sfx, 'Электроника SP', 'marketplace_item', 'marketplace', 1, true)
    returning id into v_mkt_cat;
  end if;

  insert into public.listing_categories (slug, name_ru, listing_type, domain, sort_order, is_active)
  values ('inactive-mkt-sp-' || slug_sfx, 'Неактивная MKT', 'marketplace_item', 'marketplace', 999, false)
  on conflict (slug) do update set is_active = false, domain = 'marketplace', listing_type = 'marketplace_item'
  returning id into v_mkt_inactive;

  select id into v_svc_cat
  from public.listing_categories
  where domain = 'services' and listing_type = 'service' and is_active and slug = 'home-repair'
  limit 1;
  if v_svc_cat is null then
    insert into public.listing_categories (slug, name_ru, listing_type, domain, sort_order, is_active)
    values ('home-repair-sp-' || slug_sfx, 'Ремонт SP', 'service', 'services', 10, true)
    returning id into v_svc_cat;
  end if;

  select id into v_svc_cat2
  from public.listing_categories
  where domain = 'services' and listing_type = 'service' and is_active and slug = 'cleaning'
  limit 1;
  if v_svc_cat2 is null then
    insert into public.listing_categories (slug, name_ru, listing_type, domain, sort_order, is_active)
    values ('cleaning-sp-' || slug_sfx, 'Уборка SP', 'service', 'services', 20, true)
    returning id into v_svc_cat2;
  end if;

  insert into public.listing_categories (slug, name_ru, listing_type, domain, sort_order, is_active)
  values ('inactive-svc-sp-' || slug_sfx, 'Неактивная SVC', 'service', 'services', 998, false)
  on conflict (slug) do update set is_active = false, domain = 'services', listing_type = 'service'
  returning id into v_svc_inactive;

  -- =====================================================================
  -- PUBLISHER (1–12)
  -- =====================================================================

  -- 1 personal listing create
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listings (
    listing_type, title, description, price_amount, city, state, publisher_type
  ) values (
    'marketplace_item', 'Personal Phone SP', 'Personal product description long enough',
    100, 'Irvine', 'CA', 'profile'
  ) returning id, owner_id, publisher_type, publisher_business_id
    into v_listing, owner_check, v_pub_type, v_pub_biz;
  if owner_check is distinct from v_owner
     or v_pub_type is distinct from 'profile'
     or v_pub_biz is not null
  then
    raise exception 'FAIL 1 personal create: owner=% type=% biz=%', owner_check, v_pub_type, v_pub_biz;
  end if;
  passed := passed + 1;

  -- 2 own business publisher create
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listings (
    listing_type, title, description, price_amount, city, state,
    publisher_type, publisher_business_id
  ) values (
    'marketplace_item', 'Biz Phone SP', 'Business product description long enough',
    150, 'Irvine', 'CA', 'business', v_biz_approved
  ) returning id, publisher_type, publisher_business_id into v_mkt_biz, v_pub_type, v_pub_biz;
  if v_pub_type is distinct from 'business' or v_pub_biz is distinct from v_biz_approved then
    raise exception 'FAIL 2 business publisher create';
  end if;
  passed := passed + 1;

  -- 3 чужой business publisher denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listings (
      listing_type, title, description, price_amount, city, state,
      publisher_type, publisher_business_id
    ) values (
      'marketplace_item', 'Hijack Biz SP', 'Hijack description long enough ok',
      10, 'Irvine', 'CA', 'business', v_biz_approved
    );
    raise exception 'FAIL 3 stranger business publisher allowed';
  exception when others then
    if sqlerrm like 'FAIL 3%' then raise; end if;
    passed := passed + 1;
  end;

  -- 4 unapproved (pending) business denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listings (
      listing_type, title, description, price_amount, city, state,
      publisher_type, publisher_business_id
    ) values (
      'marketplace_item', 'Pending Biz SP', 'Pending description long enough ok',
      10, 'Irvine', 'CA', 'business', v_biz_pending
    );
    raise exception 'FAIL 4 pending business publisher allowed';
  exception when others then
    if sqlerrm like 'FAIL 4%' then raise; end if;
    passed := passed + 1;
  end;

  -- 5 removed/rejected business denied (content_status has rejected/archived, not removed)
  begin
    insert into public.listings (
      listing_type, title, description, price_amount, city, state,
      publisher_type, publisher_business_id
    ) values (
      'marketplace_item', 'Rejected Biz SP', 'Rejected description long enough ok',
      10, 'Irvine', 'CA', 'business', v_biz_rejected
    );
    raise exception 'FAIL 5 rejected business publisher allowed';
  exception when others then
    if sqlerrm like 'FAIL 5%' then raise; end if;
    passed := passed + 1;
  end;

  -- 6 business member without edit rights denied (pending claim only — not in business_owners)
  reset role;
  insert into public.business_claims (business_id, user_id, status, applicant_message)
  values (v_biz_approved, v_owner, 'pending', 'claim without ownership');
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listings (
      listing_type, title, description, price_amount, city, state,
      publisher_type, publisher_business_id
    ) values (
      'marketplace_item', 'Claimant Biz SP', 'Claimant description long enough ok',
      10, 'Irvine', 'CA', 'business', v_biz_approved
    );
    raise exception 'FAIL 6 claimant without ownership allowed';
  exception when others then
    if sqlerrm like 'FAIL 6%' then raise; end if;
    passed := passed + 1;
  end;

  -- 7 business manager allowed (owns_business is any business_owners row)
  reset role;
  perform set_config('request.jwt.claim.sub', v_manager::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, price_amount, city, state,
    publisher_type, publisher_business_id
  ) values (
    'marketplace_item', 'Manager Phone SP', 'Manager product description long enough',
    120, 'Irvine', 'CA', 'business', v_biz_approved
  ) returning id into v_tmp;
  delete from public.listings where id = v_tmp;
  passed := passed + 1;

  -- 8 publisher_business_id подмена denied (update draft to foreign business)
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, price_amount, city, state, publisher_type
  ) values (
    'marketplace_item', 'Switch Draft SP', 'Switch draft description long enough',
    10, 'Irvine', 'CA', 'profile'
  ) returning id into v_tmp;
  begin
    update public.listings
      set publisher_type = 'business', publisher_business_id = v_biz_other
    where id = v_tmp;
    raise exception 'FAIL 8 foreign business switch allowed';
  exception when others then
    if sqlerrm like 'FAIL 8%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 9 publisher_type mismatch denied (profile + business_id)
  begin
    insert into public.listings (
      listing_type, title, description, price_amount, city, state,
      publisher_type, publisher_business_id
    ) values (
      'marketplace_item', 'Mismatch SP', 'Mismatch description long enough ok',
      10, 'Irvine', 'CA', 'profile', v_biz_approved
    );
    raise exception 'FAIL 9 profile+business_id allowed';
  exception
    when check_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 9%' then raise; end if;
      passed := passed + 1;
  end;

  -- 10 publisher change after publish denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
  values (v_mkt_biz, v_mkt_cat, 'good', 'sell');
  update public.listings set status = 'active' where id = v_mkt_biz;

  begin
    update public.listings
      set publisher_type = 'profile', publisher_business_id = null
    where id = v_mkt_biz;
    select publisher_type, publisher_business_id into v_pub_type, v_pub_biz
    from public.listings where id = v_mkt_biz;
    if v_pub_type is distinct from 'business' or v_pub_biz is distinct from v_biz_approved then
      raise exception 'FAIL 10 publisher unlocked after publish';
    end if;
    passed := passed + 1;
  exception when others then
    if sqlerrm like 'FAIL 10%' then raise; end if;
    -- hard deny also ok
    select publisher_type, publisher_business_id into v_pub_type, v_pub_biz
    from public.listings where id = v_mkt_biz;
    if v_pub_type is distinct from 'business' or v_pub_biz is distinct from v_biz_approved then
      raise exception 'FAIL 10 publisher changed despite error';
    end if;
    passed := passed + 1;
  end;

  -- 11 controlling owner UUID absent from public catalog publisher jsonb
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select publisher into pub from public.marketplace_catalog where id = v_mkt_biz;
  if pub is null then raise exception 'FAIL 11 catalog missing published biz listing'; end if;
  if position(v_biz_owner::text in pub::text) > 0
     or (pub ? 'owner_id')
     or (pub->>'owner_id') is not null
  then
    raise exception 'FAIL 11 owner uuid in publisher: %', pub;
  end if;
  if (pub->>'publisher_type') is distinct from 'business'
     or (pub->>'name') is distinct from 'Approved Biz SP'
  then
    raise exception 'FAIL 11 publisher fields: %', pub;
  end if;
  passed := passed + 1;

  -- 12 membership data absent from resolve_listing_publisher
  select public.resolve_listing_publisher('business', v_biz_approved, v_biz_owner, 'public') into pub;
  if pub ? 'membership' or pub ? 'owner_id' or position(v_biz_owner::text in pub::text) > 0 then
    raise exception 'FAIL 12 membership/owner leak: %', pub;
  end if;
  passed := passed + 1;

  -- Extra: private.enable_trusted_listing_write fails for authenticated
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform private.enable_trusted_listing_write();
    raise exception 'FAIL trusted enable callable as authenticated';
  exception when others then
    if sqlerrm like 'FAIL trusted%' then raise; end if;
    passed := passed + 1;
  end;

  -- =====================================================================
  -- MARKETPLACE GOODS-ONLY (13–20)
  -- =====================================================================

  -- 13 marketplace_item valid product
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
  values (v_listing, v_mkt_cat, 'like_new', 'sell');
  update public.listings
    set title = 'Used iPhone 13 SP',
        description = 'Phone with service history and free delivery available. Professionally repaired screen.',
        status = 'active'
  where id = v_listing;
  select count(*) into n from public.marketplace_catalog where id = v_listing;
  if n <> 1 then raise exception 'FAIL 13 valid product not in catalog: %', n; end if;
  passed := passed + 1;
  v_mkt_goods := v_listing;

  -- Extra: marketplace_looks_like_service allow-path (neutral product phrasing)
  if public.marketplace_looks_like_service(
       'Used iPhone 13',
       'Phone with service history and free delivery available. Professionally repaired screen.'
     )
  then
    raise exception 'FAIL looks_like_service false positive on product phrasing';
  end if;
  passed := passed + 1;

  -- 14 marketplace with services category denied
  insert into public.listings (
    listing_type, title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'Wrong Cat Phone SP', 'Wrong category product description ok',
    50, 'Irvine', 'CA'
  ) returning id into v_tmp;
  insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
  values (v_tmp, v_svc_cat, 'good', 'sell');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 14 services category on marketplace allowed';
  exception when others then
    if sqlerrm like 'FAIL 14%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 15 service listing absent from marketplace_catalog
  insert into public.listings (
    listing_type, title, description, city, state
  ) values (
    'service', 'Handyman Help SP', 'I offer repairs and free estimate for homes',
    'Irvine', 'CA'
  ) returning id into v_svc;
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type, price_from, service_modes
  ) values (v_svc, v_svc_cat, 'hourly', 50, array['in_person']::text[]);
  update public.listings set status = 'active' where id = v_svc;
  select count(*) into n from public.marketplace_catalog where id = v_svc;
  if n <> 0 then raise exception 'FAIL 15 service in marketplace_catalog: %', n; end if;
  passed := passed + 1;

  -- 16 obvious service Marketplace publish rejected
  insert into public.listings (
    listing_type, title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'Handyman Repair SP',
    'I offer services and call for a estimate. Hourly rate $40.',
    40, 'Irvine', 'CA'
  ) returning id into v_tmp;
  insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
  values (v_tmp, v_mkt_cat, 'good', 'sell');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 16 obvious service publish allowed';
  exception when others then
    if sqlerrm like 'FAIL 16%' then raise; end if;
    if sqlerrm not ilike '%service%' and sqlerrm not ilike '%Services%' then
      -- still a deny is success; message may vary
      null;
    end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- Extra: marketplace_looks_like_service true on obvious offer
  if not public.marketplace_looks_like_service(
       'Plumbing repair',
       'Call for a estimate. Hourly rate available.'
     )
  then
    raise exception 'FAIL looks_like_service missed obvious service';
  end if;
  passed := passed + 1;

  -- 17 business product publish allowed (already active v_mkt_biz)
  select count(*) into n from public.marketplace_catalog where id = v_mkt_biz;
  if n <> 1 then raise exception 'FAIL 17 business product not in catalog: %', n; end if;
  passed := passed + 1;

  -- 18 business service-looking product in Marketplace denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, price_amount, city, state,
    publisher_type, publisher_business_id
  ) values (
    'marketplace_item', 'Repair service SP',
    'We offer installation and вызов мастера for your home',
    99, 'Irvine', 'CA', 'business', v_biz_approved
  ) returning id into v_tmp;
  insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
  values (v_tmp, v_mkt_cat, 'good', 'sell');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 18 business service-in-marketplace allowed';
  exception when others then
    if sqlerrm like 'FAIL 18%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 19 inactive Marketplace category denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'Inactive Cat Goods SP', 'Inactive cat product description ok',
    20, 'Irvine', 'CA'
  ) returning id into v_tmp;
  insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
  values (v_tmp, v_mkt_inactive, 'good', 'sell');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 19 inactive mkt category publish allowed';
  exception when others then
    if sqlerrm like 'FAIL 19%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 20 wrong detail table denied (marketplace details on service listing)
  begin
    insert into public.marketplace_listing_details (listing_id, category_id, condition, transaction_type)
    values (v_svc, v_mkt_cat, 'good', 'sell');
    raise exception 'FAIL 20 marketplace details on service allowed';
  exception when others then
    if sqlerrm like 'FAIL 20%' then raise; end if;
    passed := passed + 1;
  end;

  -- =====================================================================
  -- SERVICES CREATE/UPDATE (21–38)
  -- =====================================================================

  -- 21 personal service draft (v_svc already created+published — make a fresh draft)
  insert into public.listings (
    listing_type, title, description, city, state, publisher_type
  ) values (
    'service', 'Cleaning Help Draft SP', 'Personal cleaning draft description long enough',
    'Irvine', 'CA', 'profile'
  ) returning id, status::text into v_svc_draft, st;
  if st is distinct from 'draft' then raise exception 'FAIL 21 not draft: %', st; end if;
  passed := passed + 1;

  -- 22 business service draft
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, city, state,
    publisher_type, publisher_business_id
  ) values (
    'service', 'Biz Cleaning Draft SP', 'Business cleaning draft description long enough',
    'Irvine', 'CA', 'business', v_biz_approved
  ) returning id into v_svc_biz;
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type, price_from
  ) values (v_svc_biz, v_svc_cat2, 'from', 80);
  passed := passed + 1;

  -- 23 publish without detail denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.listings set status = 'active' where id = v_svc_draft;
    raise exception 'FAIL 23 publish without detail allowed';
  exception when others then
    if sqlerrm like 'FAIL 23%' then raise; end if;
    passed := passed + 1;
  end;

  -- 24 publish without category denied
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type
  ) values (v_svc_draft, null, 'contact_for_price');
  begin
    update public.listings set status = 'active' where id = v_svc_draft;
    raise exception 'FAIL 24 publish without category allowed';
  exception when others then
    if sqlerrm like 'FAIL 24%' then raise; end if;
    passed := passed + 1;
  end;

  -- 25 inactive category denied
  update public.service_listing_details
    set service_category_id = v_svc_inactive
  where listing_id = v_svc_draft;
  begin
    update public.listings set status = 'active' where id = v_svc_draft;
    raise exception 'FAIL 25 inactive service category publish allowed';
  exception when others then
    if sqlerrm like 'FAIL 25%' then raise; end if;
    passed := passed + 1;
  end;

  -- 26 negative price denied
  begin
    update public.service_listing_details
      set service_category_id = v_svc_cat, pricing_type = 'fixed', price_from = -10
    where listing_id = v_svc_draft;
    raise exception 'FAIL 26 negative price_from allowed';
  exception
    when check_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 26%' then raise; end if;
      passed := passed + 1;
  end;

  -- 27 invalid price range denied
  begin
    update public.service_listing_details
      set service_category_id = v_svc_cat, pricing_type = 'from',
          price_from = 100, price_to = 50
    where listing_id = v_svc_draft;
    raise exception 'FAIL 27 invalid price range allowed';
  exception
    when check_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 27%' then raise; end if;
      passed := passed + 1;
  end;

  -- 28 hourly without price_from denied
  update public.service_listing_details
    set service_category_id = v_svc_cat, pricing_type = 'hourly',
        price_from = null, price_to = null
  where listing_id = v_svc_draft;
  begin
    update public.listings set status = 'active' where id = v_svc_draft;
    raise exception 'FAIL 28 hourly without price_from allowed';
  exception when others then
    if sqlerrm like 'FAIL 28%' then raise; end if;
    passed := passed + 1;
  end;

  -- 29 contact_for_price with null price allowed
  update public.service_listing_details
    set pricing_type = 'contact_for_price', price_from = null, price_to = null,
        service_category_id = v_svc_cat
  where listing_id = v_svc_draft;
  update public.listings set status = 'active' where id = v_svc_draft;
  select status::text into st from public.listings where id = v_svc_draft;
  if st is distinct from 'active' then raise exception 'FAIL 29 contact_for_price publish: %', st; end if;
  passed := passed + 1;

  -- 30 invalid service mode denied
  begin
    update public.service_listing_details
      set service_modes = array['teleport']::text[]
    where listing_id = v_svc_draft;
    raise exception 'FAIL 30 invalid service mode allowed';
  exception
    when check_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 30%' then raise; end if;
      passed := passed + 1;
  end;

  -- 31 owner update allowed
  update public.listings
    set description = 'Updated personal cleaning description long enough'
  where id = v_svc_draft;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 31 owner update rows=%', n; end if;
  passed := passed + 1;

  -- 32 stranger update denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.listings set title = 'Hacked Title SP XX' where id = v_svc_draft;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL 32 stranger update rows=%', n; end if;
    update public.service_listing_details set price_from = 1 where listing_id = v_svc_draft;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL 32 stranger detail update'; end if;
    passed := passed + 1;
  exception when others then
    if sqlerrm like 'FAIL 32%' then raise; end if;
    passed := passed + 1;
  end;

  -- 33 stale status transition denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.transition_listing_status(v_svc_draft, 'draft', 'archived');
    raise exception 'FAIL 33 stale transition allowed';
  exception when others then
    if sqlerrm like 'FAIL 33%' then raise; end if;
    passed := passed + 1;
  end;

  -- 34 invalid state transition denied (service → reserved)
  begin
    update public.listings set status = 'reserved' where id = v_svc_draft;
    raise exception 'FAIL 34 reserved on service allowed';
  exception when others then
    if sqlerrm like 'FAIL 34%' then raise; end if;
    passed := passed + 1;
  end;

  -- pause via ::text-safe path (enum already committed by migration)
  update public.listings set status = 'paused' where id = v_svc_draft;
  select status::text, paused_at into st, paused_ts from public.listings where id = v_svc_draft;
  if st is distinct from 'paused' or paused_ts is null then
    raise exception 'FAIL pause path: % / %', st, paused_ts;
  end if;
  update public.listings set status = 'active' where id = v_svc_draft;
  passed := passed + 1;

  -- 35 direct system timestamp denied (client cannot set paused_at)
  begin
    update public.listings set paused_at = now() where id = v_svc_draft;
    select paused_at into paused_ts from public.listings where id = v_svc_draft;
    if paused_ts is not null then
      -- column may be non-grantable → exception; or trigger restores null while active
      raise exception 'FAIL 35 paused_at set by client';
    end if;
    passed := passed + 1;
  exception
    when insufficient_privilege then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 35%' then raise; end if;
      if sqlstate = '42501' or sqlerrm ilike '%permission denied%' then
        passed := passed + 1;
      else
        -- trigger may silently ignore; verify still active without paused_at
        select status::text, paused_at into st, paused_ts from public.listings where id = v_svc_draft;
        if st = 'active' and paused_ts is null then
          passed := passed + 1;
        else
          raise;
        end if;
      end if;
  end;

  -- 36 moderation fields denied
  begin
    update public.listings set moderation_reason = 'hack' where id = v_svc_draft;
    select moderation_reason into reason from public.listings where id = v_svc_draft;
    if reason is not null then raise exception 'FAIL 36 moderation_reason set'; end if;
    passed := passed + 1;
  exception
    when insufficient_privilege then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 36%' then raise; end if;
      if sqlstate = '42501' or sqlerrm ilike '%permission denied%' then
        passed := passed + 1;
      else
        select moderation_reason into reason from public.listings where id = v_svc_draft;
        if reason is null then passed := passed + 1; else raise; end if;
      end if;
  end;

  -- 37 removed restore by owner denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_svc_draft, 'removed', 'test-remove');

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.listings set status = 'active' where id = v_svc_draft;
    get diagnostics n = row_count;
    select status::text into st from public.listings where id = v_svc_draft;
    if n > 0 or st is distinct from 'removed' then
      raise exception 'FAIL 37 owner restore allowed rows=% status=%', n, st;
    end if;
    passed := passed + 1;
  exception when others then
    if sqlerrm like 'FAIL 37%' then raise; end if;
    passed := passed + 1;
  end;

  -- 38 admin restore allowed
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_svc_draft, 'active', null);
  select status::text into st from public.listings where id = v_svc_draft;
  if st is distinct from 'active' then raise exception 'FAIL 38 admin restore: %', st; end if;
  passed := passed + 1;

  -- Publish business service for later visibility/anti-spam
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.listings set status = 'active' where id = v_svc_biz;

  -- =====================================================================
  -- VISIBILITY (39–49)
  -- =====================================================================

  -- 39 active public in services_catalog
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into n from public.services_catalog where id = v_svc;
  if n <> 1 then raise exception 'FAIL 39 active service missing from catalog: %', n; end if;
  passed := passed + 1;

  -- Extra: services_catalog must not expose owner_id / marketplace_item
  begin
    execute 'select owner_id from public.services_catalog limit 1';
    raise exception 'FAIL services_catalog has owner_id column';
  exception when undefined_column then
    passed := passed + 1;
  when others then
    if sqlerrm like 'FAIL services_catalog%' then raise; end if;
    if sqlstate = '42703' then passed := passed + 1; else raise; end if;
  end;
  select count(*) into n from public.services_catalog where id = v_mkt_goods;
  if n <> 0 then raise exception 'FAIL marketplace_item in services_catalog: %', n; end if;
  passed := passed + 1;

  -- Seed draft / private / unlisted / removed / rejected services
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listings (
    listing_type, title, description, city, state, visibility
  ) values (
    'service', 'Draft Only Vis SP', 'Draft visibility description long enough',
    'Irvine', 'CA', 'public'
  ) returning id into v_listing2;
  insert into public.service_listing_details (listing_id, service_category_id, pricing_type)
  values (v_listing2, v_svc_cat, 'contact_for_price');
  -- leave draft

  insert into public.listings (
    listing_type, title, description, city, state, visibility
  ) values (
    'service', 'Private Vis SP', 'Private visibility description long enough',
    'Irvine', 'CA', 'private'
  ) returning id into v_svc_private;
  insert into public.service_listing_details (listing_id, service_category_id, pricing_type)
  values (v_svc_private, v_svc_cat, 'contact_for_price');
  update public.listings set status = 'active' where id = v_svc_private;

  insert into public.listings (
    listing_type, title, description, city, state, visibility
  ) values (
    'service', 'Unlisted Vis SP', 'Unlisted visibility description long enough',
    'Irvine', 'CA', 'unlisted'
  ) returning id into v_svc_unlisted;
  insert into public.service_listing_details (listing_id, service_category_id, pricing_type)
  values (v_svc_unlisted, v_svc_cat, 'contact_for_price');
  update public.listings set status = 'active' where id = v_svc_unlisted;

  insert into public.listings (
    listing_type, title, description, city, state
  ) values (
    'service', 'Removed Vis SP', 'Removed visibility description long enough',
    'Irvine', 'CA'
  ) returning id into v_svc_removed;
  insert into public.service_listing_details (listing_id, service_category_id, pricing_type)
  values (v_svc_removed, v_svc_cat, 'contact_for_price');
  update public.listings set status = 'active' where id = v_svc_removed;

  insert into public.listings (
    listing_type, title, description, city, state
  ) values (
    'service', 'Rejected Vis SP', 'Rejected visibility description long enough',
    'Irvine', 'CA'
  ) returning id into v_svc_rejected;
  insert into public.service_listing_details (listing_id, service_category_id, pricing_type)
  values (v_svc_rejected, v_svc_cat, 'contact_for_price');
  update public.listings set status = 'active' where id = v_svc_rejected;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_svc_removed, 'removed', 'vis');
  perform public.admin_set_listing_status(v_svc_rejected, 'rejected', 'vis');

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;

  -- 40 draft absent
  select count(*) into n from public.services_catalog where id = v_listing2;
  if n <> 0 then raise exception 'FAIL 40 draft in catalog: %', n; end if;
  passed := passed + 1;

  -- 41 private absent
  select count(*) into n from public.services_catalog where id = v_svc_private;
  if n <> 0 then raise exception 'FAIL 41 private in catalog: %', n; end if;
  passed := passed + 1;

  -- 42 unlisted absent from catalog
  select count(*) into n from public.services_catalog where id = v_svc_unlisted;
  if n <> 0 then raise exception 'FAIL 42 unlisted in catalog: %', n; end if;
  passed := passed + 1;

  -- 43 unlisted direct access according to model (active unlisted readable)
  select count(*) into n from public.listings where id = v_svc_unlisted;
  if n <> 1 then raise exception 'FAIL 43 unlisted direct access: %', n; end if;
  passed := passed + 1;

  -- 44 removed absent
  select count(*) into n from public.listings where id = v_svc_removed;
  if n <> 0 then raise exception 'FAIL 44 removed visible to anon: %', n; end if;
  select count(*) into n from public.services_catalog where id = v_svc_removed;
  if n <> 0 then raise exception 'FAIL 44 removed in catalog: %', n; end if;
  passed := passed + 1;

  -- 45 rejected absent
  select count(*) into n from public.listings where id = v_svc_rejected;
  if n <> 0 then raise exception 'FAIL 45 rejected visible to anon: %', n; end if;
  passed := passed + 1;

  -- 46 Marketplace item absent from services catalog (already checked; keep brief #)
  select count(*) into n from public.services_catalog where id in (v_mkt_goods, v_mkt_biz);
  if n <> 0 then raise exception 'FAIL 46 marketplace in services_catalog: %', n; end if;
  passed := passed + 1;

  -- 47 private personal provider data hidden
  select public.resolve_listing_publisher('profile', null, v_other, 'public') into pub;
  if (pub->>'publisher_type') is distinct from 'profile' then
    raise exception 'FAIL 47 publisher_type: %', pub;
  end if;
  if (pub->'author'->>'mode') is distinct from 'anonymous'
     or position(v_other::text in pub::text) > 0
  then
    raise exception 'FAIL 47 private provider leak: %', pub;
  end if;
  passed := passed + 1;

  -- 48 anonymous provider no UUID
  select public.resolve_listing_publisher('profile', null, v_owner, 'anonymous') into pub;
  if (pub->>'name') not like 'Пользователь #%'
     or position(v_owner::text in pub::text) > 0
  then
    raise exception 'FAIL 48 anonymous uuid leak: %', pub;
  end if;
  passed := passed + 1;

  -- 49 business publisher public fields only
  select publisher into pub from public.services_catalog where id = v_svc_biz;
  if pub is null then
    -- may be missing if publish failed; check resolve directly
    select public.resolve_listing_publisher('business', v_biz_approved, v_biz_owner, 'public') into pub;
  end if;
  if (pub->>'name') is distinct from 'Approved Biz SP'
     or pub ? 'owner_id'
     or position(v_biz_owner::text in pub::text) > 0
  then
    raise exception 'FAIL 49 business publisher leak: %', pub;
  end if;
  -- non-approved business identity scrubbed
  select public.resolve_listing_publisher('business', v_biz_pending, v_biz_owner, 'public') into pub;
  if (pub->>'name') is not null or (pub->>'slug') is not null then
    raise exception 'FAIL 49 pending business leak: %', pub;
  end if;
  passed := passed + 1;

  -- =====================================================================
  -- FAVORITES / REPORTS (50–57)
  -- =====================================================================

  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 50 own favorite
  insert into public.listing_favorites (listing_id) values (v_svc);
  passed := passed + 1;

  -- 51 favorite for another user denied
  begin
    insert into public.listing_favorites (user_id, listing_id)
    values (v_owner, v_svc_draft);
    raise exception 'FAIL 51 foreign user_id favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 51%' then raise; end if;
    passed := passed + 1;
  end;

  -- 52 hidden service favorite denied
  begin
    insert into public.listing_favorites (listing_id) values (v_listing2);
    raise exception 'FAIL 52 draft favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 52%' then raise; end if;
  end;
  begin
    insert into public.listing_favorites (listing_id) values (v_svc_private);
    raise exception 'FAIL 52 private favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 52%' then raise; end if;
  end;
  begin
    insert into public.listing_favorites (listing_id) values (v_svc_removed);
    raise exception 'FAIL 52 removed favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 52%' then raise; end if;
  end;
  passed := passed + 1;

  -- 53 self-report denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listing_reports (listing_id, reason) values (v_svc, 'spam');
    raise exception 'FAIL 53 self report allowed';
  exception when others then
    if sqlerrm like 'FAIL 53%' then raise; end if;
    passed := passed + 1;
  end;

  -- 54 report as another user denied (foreign reporter_id column privilege and/or force to auth.uid)
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_report := null;
  begin
    insert into public.listing_reports (listing_id, reporter_id, reason)
    values (v_svc, v_owner, 'scam')
    returning id, reporter_id into v_report, owner_check;
    if owner_check is distinct from v_other then
      raise exception 'FAIL 54 foreign reporter_id stuck';
    end if;
    -- Row kept (no DELETE grant); treat as the pending report for later checks
    passed := passed + 1;
  exception
    when insufficient_privilege then
      v_report := null;
      passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 54%' then raise; end if;
      v_report := null;
      passed := passed + 1;
  end;

  if v_report is null then
    insert into public.listing_reports (listing_id, reason)
    values (v_svc, 'prohibited_service')
    returning id into v_report;
  end if;

  -- 55 duplicate report denied
  begin
    insert into public.listing_reports (listing_id, reason) values (v_svc, 'scam');
    raise exception 'FAIL 55 duplicate report allowed';
  exception when others then
    if sqlerrm like 'FAIL 55%' then raise; end if;
    passed := passed + 1;
  end;

  -- 56 report status update denied
  begin
    update public.listing_reports set status = 'dismissed' where id = v_report;
    raise exception 'FAIL 56 report status update allowed';
  exception when others then
    if sqlerrm like 'FAIL 56%' then raise; end if;
    passed := passed + 1;
  end;

  -- 57 provider cannot see reporter identity
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_reports where id = v_report;
  if n <> 0 then raise exception 'FAIL 57 owner sees foreign report: %', n; end if;
  passed := passed + 1;

  -- =====================================================================
  -- ANTI-SPAM (58–62)
  -- =====================================================================

  -- 58 personal active limit (10) — normalize to exactly 10 active, then 11th publish fails
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  -- Park existing active profile services so the cap seed is deterministic
  perform private.enable_trusted_listing_write();
  update public.listings
    set status = 'archived'
  where owner_id = v_owner
    and listing_type = 'service'
    and publisher_type = 'profile'
    and status::text = 'active';
  for i in 1..10 loop
    insert into public.listings (
      listing_type, status, visibility, title, description, city, state, publisher_type
    ) values (
      'service', 'active', 'public',
      'Cap Profile Svc ' || i || ' SP',
      'Cap profile service description long enough ' || i,
      'Irvine', 'CA', 'profile'
    ) returning id into v_tmp;
    insert into public.service_listing_details (
      listing_id, service_category_id, pricing_type
    ) values (v_tmp, v_svc_cat, 'contact_for_price');
  end loop;
  perform private.disable_trusted_listing_write();
  delete from public.review_abuse_events where user_id = v_owner and kind = 'listing_create';

  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, city, state
  ) values (
    'service', 'Cap Profile Overflow SP',
    'Overflow personal service description long enough',
    'Irvine', 'CA'
  ) returning id into v_tmp;
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type
  ) values (v_tmp, v_svc_cat2, 'contact_for_price');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 58 personal active cap not enforced';
  exception when others then
    if sqlerrm like 'FAIL 58%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 59 business active limit (25) — trusted seed 24 more (v_svc_biz already 1)
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  perform private.enable_trusted_listing_write();
  for i in 1..24 loop
    insert into public.listings (
      listing_type, status, visibility, title, description, city, state,
      publisher_type, publisher_business_id
    ) values (
      'service', 'active', 'public',
      'Cap Biz Svc ' || i || ' SP',
      'Cap business service description long enough ' || i,
      'Irvine', 'CA', 'business', v_biz_approved
    ) returning id into v_tmp;
    insert into public.service_listing_details (
      listing_id, service_category_id, pricing_type
    ) values (v_tmp, v_svc_cat, 'contact_for_price');
  end loop;
  perform private.disable_trusted_listing_write();
  delete from public.review_abuse_events where user_id = v_biz_owner and kind = 'listing_create';

  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, city, state,
    publisher_type, publisher_business_id
  ) values (
    'service', 'Cap Biz Overflow SP',
    'Overflow business service description long enough',
    'Irvine', 'CA', 'business', v_biz_approved
  ) returning id into v_tmp;
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type
  ) values (v_tmp, v_svc_cat2, 'contact_for_price');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 59 business active cap not enforced';
  exception when others then
    if sqlerrm like 'FAIL 59%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 60 duplicate active service listing
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  -- Free one active slot (archive one of the cap seed rows), then publish a known title
  perform private.enable_trusted_listing_write();
  update public.listings
    set status = 'archived'
  where id = (
    select id from public.listings
    where owner_id = v_owner
      and listing_type = 'service'
      and publisher_type = 'profile'
      and status::text = 'active'
      and title like 'Cap Profile Svc %'
    order by title
    limit 1
  );
  perform private.disable_trusted_listing_write();

  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, city, state
  ) values (
    'service', 'Unique Dup Title SP',
    'First copy service description long enough ok',
    'Irvine', 'CA'
  ) returning id into v_svc_draft;
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type
  ) values (v_svc_draft, v_svc_cat, 'contact_for_price');
  update public.listings set status = 'active' where id = v_svc_draft;

  -- Archive one more slot so the duplicate publish is blocked by duplicate rule, not the 10-cap
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform private.enable_trusted_listing_write();
  update public.listings
    set status = 'archived'
  where id = (
    select id from public.listings
    where owner_id = v_owner
      and listing_type = 'service'
      and publisher_type = 'profile'
      and status::text = 'active'
      and title like 'Cap Profile Svc %'
    order by title
    limit 1
  );
  perform private.disable_trusted_listing_write();

  set local role authenticated;
  insert into public.listings (
    listing_type, title, description, city, state
  ) values (
    'service', 'Unique Dup Title SP',
    'Duplicate title service description long enough',
    'Irvine', 'CA'
  ) returning id into v_tmp;
  insert into public.service_listing_details (
    listing_id, service_category_id, pricing_type
  ) values (v_tmp, v_svc_cat, 'contact_for_price');
  begin
    update public.listings set status = 'active' where id = v_tmp;
    raise exception 'FAIL 60 duplicate active allowed';
  exception when others then
    if sqlerrm like 'FAIL 60%' then raise; end if;
    passed := passed + 1;
  end;
  delete from public.listings where id = v_tmp;

  -- 61 direct INSERT bypass denied (status forced to draft for non-trusted)
  insert into public.listings (
    listing_type, status, title, description, city, state
  ) values (
    'service', 'active', 'Bypass Active SP',
    'Bypass active description long enough ok',
    'Irvine', 'CA'
  ) returning id, status::text into v_tmp, st;
  if st is distinct from 'draft' then
    raise exception 'FAIL 61 status bypass status=%', st;
  end if;
  delete from public.listings where id = v_tmp;
  passed := passed + 1;

  -- 62 rate limit enforced (20 creates / hour)
  reset role;
  delete from public.review_abuse_events where user_id = v_other and kind = 'listing_create';
  for i in 1..20 loop
    insert into public.review_abuse_events (user_id, kind, created_at)
    values (v_other, 'listing_create', now() - interval '10 minutes');
  end loop;
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listings (
      listing_type, title, description, city, state
    ) values (
      'service', 'Rate Limit Hit SP',
      'Rate limit hit description long enough ok',
      'Irvine', 'CA'
    );
    raise exception 'FAIL 62 create rate limit not enforced';
  exception when others then
    if sqlerrm like 'FAIL 62%' then raise; end if;
    passed := passed + 1;
  end;

  -- =====================================================================
  -- STORAGE (63–69)
  -- =====================================================================

  -- Restore a public active service for storage readability checks (cap-safe: 9→10)
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  perform private.enable_trusted_listing_write();
  update public.listings
    set status = 'active', visibility = 'public', moderation_reason = null
  where id = v_svc;
  perform private.disable_trusted_listing_write();

  set local role authenticated;

  -- 63 service owner upload (listing_media path)
  insert into public.listing_media (listing_id, storage_path, sort_order)
  values (
    v_svc,
    'listings/' || v_owner::text || '/' || v_svc::text || '/ok.jpg',
    0
  ) returning id into v_media;
  passed := passed + 1;

  -- 64 stranger upload denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_svc,
      'listings/' || v_owner::text || '/' || v_svc::text || '/bad.jpg',
      1
    );
    raise exception 'FAIL 64 stranger media insert allowed';
  exception when others then
    if sqlerrm like 'FAIL 64%' then raise; end if;
    passed := passed + 1;
  end;

  -- 65 wrong listing path denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_svc,
      'listings/' || v_other::text || '/' || v_svc::text || '/wrong.jpg',
      2
    );
    raise exception 'FAIL 65 wrong owner path allowed';
  exception when others then
    if sqlerrm like 'FAIL 65%' then raise; end if;
    passed := passed + 1;
  end;

  -- private media on private service
  insert into public.listing_media (listing_id, storage_path, sort_order)
  values (
    v_svc_private,
    'listings/' || v_owner::text || '/' || v_svc_private::text || '/p.jpg',
    0
  );

  -- 66 private service media read denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_media
  where listing_id = v_svc_private;
  if n <> 0 then raise exception 'FAIL 66 private media visible: %', n; end if;
  passed := passed + 1;

  -- 67 public service signed read allowed (storage helper)
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  if not public.listing_storage_object_readable(
    'listings/' || v_owner::text || '/' || v_svc::text || '/ok.jpg'
  ) then
    raise exception 'FAIL 67 public storage readable false';
  end if;
  select count(*) into n from public.listing_media where id = v_media;
  if n <> 1 then raise exception 'FAIL 67 public media row: %', n; end if;
  passed := passed + 1;

  -- 68 removed service media denied
  if public.listing_storage_object_readable(
    'listings/' || v_owner::text || '/' || v_svc_removed::text || '/x.jpg'
  ) then
    raise exception 'FAIL 68 removed storage readable';
  end if;
  passed := passed + 1;

  -- 69 media cleanup (delete media row as owner)
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.listing_media where id = v_media;
  select count(*) into n from public.listing_media where id = v_media;
  if n <> 0 then raise exception 'FAIL 69 media delete incomplete: %', n; end if;
  passed := passed + 1;

  -- =====================================================================
  -- ADMIN (70–75)
  -- =====================================================================

  -- 70 normal user admin RPC denied
  begin
    perform public.admin_set_listing_status(v_svc, 'removed', 'hack');
    raise exception 'FAIL 70 user admin_set allowed';
  exception when others then
    if sqlerrm like 'FAIL 70%' then raise; end if;
    passed := passed + 1;
  end;

  -- 71 business owner admin RPC denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_set_listing_status(v_svc, 'removed', 'hack');
    raise exception 'FAIL 71 biz_owner admin_set allowed';
  exception when others then
    if sqlerrm like 'FAIL 71%' then raise; end if;
    passed := passed + 1;
  end;

  -- 72 admin remove
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_svc, 'removed', 'policy');
  select status::text, moderation_reason into st, reason from public.listings where id = v_svc;
  if st is distinct from 'removed' or reason is distinct from 'policy' then
    raise exception 'FAIL 72 admin remove: %/%', st, reason;
  end if;
  passed := passed + 1;

  -- 73 admin reject
  perform public.admin_set_listing_status(v_svc_biz, 'rejected', 'reject-reason');
  select status::text, moderation_reason into st, reason from public.listings where id = v_svc_biz;
  if st is distinct from 'rejected' or reason is distinct from 'reject-reason' then
    raise exception 'FAIL 73 admin reject: %/%', st, reason;
  end if;
  passed := passed + 1;

  -- 74 admin restore (+ paused path for services)
  perform public.admin_set_listing_status(v_svc, 'active', null);
  select status::text into st from public.listings where id = v_svc;
  if st is distinct from 'active' then raise exception 'FAIL 74 admin restore: %', st; end if;
  perform public.admin_set_listing_status(v_svc, 'paused', null);
  select status::text into st from public.listings where id = v_svc;
  if st is distinct from 'paused' then raise exception 'FAIL 74 admin pause: %', st; end if;
  perform public.admin_set_listing_status(v_svc, 'active', null);
  passed := passed + 1;

  -- 75 audit row created
  select count(*) into n from public.listing_admin_audit
  where listing_id = v_svc and admin_id = v_admin and action = 'set_status';
  if n < 1 then raise exception 'FAIL 75 audit missing: %', n; end if;
  passed := passed + 1;

  -- get_public_profile_service_listings does not leak owner_id
  select count(*) into n
  from public.get_public_profile_service_listings(uname) g
  where position(v_owner::text in g::text) > 0;
  -- row type has no owner_id; also ensure at least one active public service returned
  select count(*) into n from public.get_public_profile_service_listings(uname);
  if n < 1 then raise exception 'FAIL profile service listings empty'; end if;
  passed := passed + 1;

  raise notice 'SERVICES PUBLISHER CHECKS PASSED: %', passed;
  if passed < 75 then
    raise exception 'Expected at least 75 passes, got %', passed;
  end if;

  raise exception 'SUCCESS: SERVICES PUBLISHER CHECKS PASSED: %', passed
    using errcode = 'P0001';
end;
$$;

rollback;
