-- Listings + profiles privacy RLS/security suite.
-- Single transaction; ROLLBACK. Requires migration 20260719120000_profiles_and_listings_mvp.
-- Do NOT run against production without review. Prefer local or confirmed remote.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_biz_owner uuid := gen_random_uuid();
  v_cat uuid;
  v_cat_inactive uuid;
  v_listing_public uuid;
  v_listing_draft uuid;
  v_listing_private uuid;
  v_listing_unlisted uuid;
  v_listing_removed uuid;
  v_listing_rejected uuid;
  v_listing_free uuid;
  v_listing_no_detail uuid;
  v_listing_no_cat uuid;
  v_listing_media_cap uuid;
  v_hijack uuid;
  v_media uuid;
  v_report uuid;
  v_report2 uuid;
  v_report_dup uuid;
  v_dummy_listing uuid;
  n int;
  passed int := 0;
  label text;
  st listing_status;
  reason text;
  prof jsonb;
  auth_disp jsonb;
  owner_check uuid;
  price_val numeric;
  completed_ts timestamptz;
  uname text := 'testuser_' || substr(replace(v_owner::text, '-', ''), 1, 8);
  other_uname text := 'other_' || substr(replace(v_other::text, '-', ''), 1, 8);
  admin_uname text := 'admin_' || substr(replace(v_admin::text, '-', ''), 1, 8);
  biz_uname text := 'bizown_' || substr(replace(v_biz_owner::text, '-', ''), 1, 8);
  i int;
begin
  -- ===== Seed users (elevated) =====
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
     now() - interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false);

  insert into public.profiles (
    id, display_name, username, role, profile_visibility,
    show_listings_in_profile, public_activity_enabled, created_at
  ) values
    (v_owner, 'Sam Owner', uname, 'user', 'public', true, true, now() - interval '3 days'),
    (v_other, 'Other User', other_uname, 'user', 'private', true, true, now() - interval '3 days'),
    (v_admin, 'Admin User', admin_uname, 'admin', 'public', true, true, now() - interval '3 days'),
    (v_biz_owner, 'Biz Owner', biz_uname, 'business_owner', 'public', true, true, now() - interval '3 days')
  on conflict (id) do update
    set display_name = excluded.display_name,
        username = excluded.username,
        role = excluded.role,
        profile_visibility = excluded.profile_visibility,
        created_at = excluded.created_at;

  select id into v_cat from public.listing_categories where slug = 'electronics' and is_active limit 1;
  if v_cat is null then
    insert into public.listing_categories (slug, name_ru, listing_type, sort_order, is_active)
    values ('electronics-rls', 'Электроника RLS', 'marketplace_item', 1, true)
    returning id into v_cat;
  end if;

  insert into public.listing_categories (slug, name_ru, listing_type, sort_order, is_active)
  values ('inactive-rls-' || substr(replace(v_owner::text, '-', ''), 1, 8), 'Неактивная', 'marketplace_item', 999, false)
  on conflict (slug) do update set is_active = false
  returning id into v_cat_inactive;

  -- ===== Owner creates baseline listings =====
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Draft Phone', 'Draft description long enough', 100, 'Irvine', 'CA'
  ) returning id into v_listing_draft;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type, pickup_available
  ) values (v_listing_draft, v_cat, 'good', 'sell', true);

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Public Phone', 'Public description long enough', 200, 'Irvine', 'CA'
  ) returning id into v_listing_public;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type, pickup_available
  ) values (v_listing_public, v_cat, 'like_new', 'sell', true);

  update public.listings set status = 'active' where id = v_listing_public;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'private', 'public',
    'Private Phone', 'Private description long enough', 50, 'Irvine', 'CA'
  ) returning id into v_listing_private;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_private, v_cat, 'fair', 'sell');

  update public.listings set status = 'active' where id = v_listing_private;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'unlisted', 'public',
    'Unlisted Phone', 'Unlisted description long enough', 75, 'Irvine', 'CA'
  ) returning id into v_listing_unlisted;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_unlisted, v_cat, 'good', 'sell');

  update public.listings set status = 'active' where id = v_listing_unlisted;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Removed Phone', 'Removed description long enough', 80, 'Irvine', 'CA'
  ) returning id into v_listing_removed;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_removed, v_cat, 'good', 'sell');

  update public.listings set status = 'active' where id = v_listing_removed;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Rejected Phone', 'Rejected description long enough', 85, 'Irvine', 'CA'
  ) returning id into v_listing_rejected;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_rejected, v_cat, 'good', 'sell');

  update public.listings set status = 'active' where id = v_listing_rejected;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Media Cap Phone', 'Media cap description long enough', 90, 'Irvine', 'CA'
  ) returning id into v_listing_media_cap;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_media_cap, v_cat, 'good', 'sell');

  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1 foreign owner_id on INSERT denied (or forced to auth.uid)
  begin
    insert into public.listings (
      owner_id, listing_type, title, description, price_amount, city, state
    ) values (
      v_owner, 'marketplace_item', 'Hijack Title XX', 'Hijack description long enough', 1, 'Irvine', 'CA'
    );
    raise exception 'FAIL 1 foreign owner_id insert allowed';
  exception when others then
    if sqlerrm like 'FAIL 1%' then raise; end if;
  end;

  insert into public.listings (
    listing_type, title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'Own Title XX', 'Own description long enough ok', 1, 'Irvine', 'CA'
  ) returning id, owner_id into v_hijack, owner_check;
  if owner_check is distinct from v_other then
    raise exception 'FAIL 1 owner_id not auth.uid: %', owner_check;
  end if;
  delete from public.listings where id = v_hijack;
  passed := passed + 1;

  -- 2 owner_id UPDATE denied (column privilege and/or trigger)
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    update public.listings set owner_id = v_other where id = v_listing_public;
    select owner_id into owner_check from public.listings where id = v_listing_public;
    if owner_check is distinct from v_owner then
      raise exception 'FAIL 2 owner_id changed';
    end if;
    -- Trigger silently kept owner_id — also a pass
    passed := passed + 1;
  exception
    when insufficient_privilege then
      passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 2%' then raise; end if;
      -- permission denied for column also surfaces as 42501 / generic
      if sqlstate = '42501' or sqlerrm ilike '%permission denied%' then
        passed := passed + 1;
      else
        raise;
      end if;
  end;

  -- 3 direct system status UPDATE to removed denied
  begin
    update public.listings set status = 'removed' where id = v_listing_public;
    raise exception 'FAIL 3 removed status allowed';
  exception when others then
    if sqlerrm like 'FAIL 3%' then raise; end if;
    passed := passed + 1;
  end;

  -- 4 trusted GUC bypass denied
  perform set_config('app.listing_trusted_write', '1', true);
  perform set_config('app.trusted_listing_write', '1', true);
  begin
    update public.listings set status = 'removed' where id = v_listing_public;
    select status into st from public.listings where id = v_listing_public;
    if st = 'removed' then raise exception 'FAIL 4 guc bypass removed'; end if;
  exception when others then
    if sqlerrm like 'FAIL 4%' then raise; end if;
  end;
  begin
    perform private.enable_trusted_listing_write();
    raise exception 'FAIL 4 enable_trusted callable as authenticated';
  exception when others then
    if sqlerrm like 'FAIL 4%' then raise; end if;
  end;
  passed := passed + 1;

  -- 5 private helper EXECUTE denied
  begin
    perform private.enable_trusted_listing_write();
    raise exception 'FAIL 5 enable_trusted';
  exception when others then
    if sqlerrm like 'FAIL 5%' then raise; end if;
  end;
  begin
    perform private.has_trusted_listing_write();
    raise exception 'FAIL 5 has_trusted';
  exception when others then
    if sqlerrm like 'FAIL 5%' then raise; end if;
  end;
  passed := passed + 1;

  -- 6 private profile leakage via direct select
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n
  from public.profiles
  where id = v_other and display_name = 'Other User';
  if n <> 0 then raise exception 'FAIL 6 private profile direct select: %', n; end if;
  passed := passed + 1;

  -- 7 private profile leakage via get_public_profile RPC
  select public.get_public_profile(other_uname) into prof;
  if (prof->>'mode') is distinct from 'private'
     or (prof->>'display_name') is not null
     or (prof->>'avatar_url') is not null
     or (prof->>'bio') is not null
     or (prof->>'username') is not null
     or (prof->>'owner_id') is not null
  then
    raise exception 'FAIL 7 get_public_profile private leak: %', prof;
  end if;
  passed := passed + 1;

  -- 8 anonymous author UUID leakage
  select public.resolve_author_display(v_owner, 'anonymous') into auth_disp;
  label := auth_disp->>'label';
  if label not like 'Пользователь #%' then raise exception 'FAIL 8 anonymous label: %', label; end if;
  if position(v_owner::text in auth_disp::text) > 0 then raise exception 'FAIL 8 uuid leaked: %', auth_disp; end if;
  passed := passed + 1;

  -- 9 public author name when profile public + visibility public
  select public.resolve_author_display(v_owner, 'public') into auth_disp;
  if (auth_disp->>'label') is distinct from 'Sam Owner' then
    raise exception 'FAIL 9 public author name: %', auth_disp;
  end if;
  passed := passed + 1;

  -- 10 initials transformation Sam O.
  select public.resolve_author_display(v_owner, 'initials') into auth_disp;
  if (auth_disp->>'label') is distinct from 'Sam O.' then
    raise exception 'FAIL 10 initials: %', auth_disp;
  end if;
  passed := passed + 1;

  -- resolve_author_display: private profile + public mode → anonymous to stranger
  select public.resolve_author_display(v_other, 'public') into auth_disp;
  if (auth_disp->>'mode') is distinct from 'anonymous'
     or (auth_disp->>'label') not like 'Пользователь #%'
     or position(v_other::text in auth_disp::text) > 0
  then
    raise exception 'FAIL private profile public mode leak: %', auth_disp;
  end if;
  passed := passed + 1;

  -- 11 private listing direct select denied for other/anon
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listings where id = v_listing_private;
  if n <> 0 then raise exception 'FAIL 11 other private listing: %', n; end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into n from public.listings where id = v_listing_private;
  if n <> 0 then raise exception 'FAIL 11 anon private listing: %', n; end if;
  passed := passed + 1;

  -- Admin sets removed/rejected for visibility checks
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_listing_removed, 'removed', 'test');
  perform public.admin_set_listing_status(v_listing_rejected, 'rejected', 'test');

  -- 12 unlisted excluded from marketplace_catalog
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into n from public.marketplace_catalog where id = v_listing_unlisted;
  if n <> 0 then raise exception 'FAIL 12 unlisted in catalog: %', n; end if;
  passed := passed + 1;

  -- 13 unlisted direct access allowed for anon when active
  select count(*) into n from public.listings where id = v_listing_unlisted;
  if n <> 1 then raise exception 'FAIL 13 unlisted direct access: %', n; end if;
  passed := passed + 1;

  -- 14 removed direct access denied for anon
  select count(*) into n from public.listings where id = v_listing_removed;
  if n <> 0 then raise exception 'FAIL 14 removed visible to anon: %', n; end if;
  passed := passed + 1;

  -- 15 rejected direct access denied for anon
  select count(*) into n from public.listings where id = v_listing_rejected;
  if n <> 0 then raise exception 'FAIL 15 rejected visible to anon: %', n; end if;
  passed := passed + 1;

  -- 16 detail for foreign listing denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.marketplace_listing_details
      set transaction_type = 'free'
    where listing_id = v_listing_public;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL 16 foreign detail update'; end if;
    insert into public.marketplace_listing_details (listing_id, category_id, transaction_type)
    values (v_listing_draft, v_cat, 'sell')
    on conflict (listing_id) do update set category_id = excluded.category_id;
    raise exception 'FAIL 16 foreign detail insert';
  exception when others then
    if sqlerrm like 'FAIL 16%' then raise; end if;
    passed := passed + 1;
  end;

  -- 17 detail for private listing denied for other
  select count(*) into n
  from public.marketplace_listing_details
  where listing_id = v_listing_private;
  if n <> 0 then raise exception 'FAIL 17 private detail visible: %', n; end if;
  passed := passed + 1;

  -- 18 media insert for foreign listing denied
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_listing_public,
      'listings/' || v_owner::text || '/' || v_listing_public::text || '/x.jpg',
      99
    );
    raise exception 'FAIL 18 foreign media insert';
  exception when others then
    if sqlerrm like 'FAIL 18%' then raise; end if;
    passed := passed + 1;
  end;

  -- Owner media setup for checks 19–21, 47–48
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listing_media (listing_id, storage_path, sort_order)
  values (
    v_listing_private,
    'listings/' || v_owner::text || '/' || v_listing_private::text || '/p.jpg',
    0
  ) returning id into v_media;

  for i in 0..9 loop
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_listing_media_cap,
      'listings/' || v_owner::text || '/' || v_listing_media_cap::text || '/m' || i || '.jpg',
      i
    );
  end loop;

  -- 19 11th media denied
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_listing_media_cap,
      'listings/' || v_owner::text || '/' || v_listing_media_cap::text || '/m10.jpg',
      10
    );
    raise exception 'FAIL 19 11th media allowed';
  exception when others then
    if sqlerrm like 'FAIL 19%' then raise; end if;
    passed := passed + 1;
  end;

  -- 20 duplicate sort_order denied
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_listing_media_cap,
      'listings/' || v_owner::text || '/' || v_listing_media_cap::text || '/dup.jpg',
      0
    );
    raise exception 'FAIL 20 duplicate sort_order allowed';
  exception
    when unique_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 20%' then raise; end if;
      passed := passed + 1;
  end;

  -- listing_media path with wrong owner segment denied
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_listing_public,
      'listings/' || v_other::text || '/' || v_listing_public::text || '/bad.jpg',
      50
    );
    raise exception 'FAIL wrong owner segment allowed';
  exception when others then
    if sqlerrm like 'FAIL wrong owner%' then raise; end if;
    passed := passed + 1;
  end;

  -- storage path traversal .. denied in media trigger
  begin
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (
      v_listing_public,
      'listings/' || v_owner::text || '/' || v_listing_public::text || '/../escape.jpg',
      51
    );
    raise exception 'FAIL path traversal allowed';
  exception when others then
    if sqlerrm like 'FAIL path traversal%' then raise; end if;
    passed := passed + 1;
  end;

  -- 21 private media read denied for other
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.listing_media where id = v_media;
  if n <> 0 then raise exception 'FAIL 21 private media visible: %', n; end if;
  passed := passed + 1;

  -- 22 favorite as another user denied (insert with foreign user_id)
  begin
    insert into public.listing_favorites (user_id, listing_id)
    values (v_owner, v_listing_public);
    raise exception 'FAIL 22 foreign user_id favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 22%' then raise; end if;
    passed := passed + 1;
  end;

  -- 23 favorite hidden/draft/removed listing denied
  begin
    insert into public.listing_favorites (listing_id) values (v_listing_draft);
    raise exception 'FAIL 23 draft favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 23%' then raise; end if;
  end;
  begin
    insert into public.listing_favorites (listing_id) values (v_listing_private);
    raise exception 'FAIL 23 private favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 23%' then raise; end if;
  end;
  begin
    insert into public.listing_favorites (listing_id) values (v_listing_removed);
    raise exception 'FAIL 23 removed favorite allowed';
  exception when others then
    if sqlerrm like 'FAIL 23%' then raise; end if;
  end;
  passed := passed + 1;

  -- Valid favorite for report flow
  insert into public.listing_favorites (listing_id) values (v_listing_public);

  -- 24 self-report denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.listing_reports (listing_id, reason) values (v_listing_public, 'spam');
    raise exception 'FAIL 24 self report allowed';
  exception when others then
    if sqlerrm like 'FAIL 24%' then raise; end if;
    passed := passed + 1;
  end;

  -- 25 report status UPDATE denied for non-admin
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.listing_reports (listing_id, reason) values (v_listing_public, 'spam')
  returning id into v_report;
  begin
    update public.listing_reports set status = 'dismissed' where id = v_report;
    raise exception 'FAIL 25 report status update allowed';
  exception when others then
    if sqlerrm like 'FAIL 25%' then raise; end if;
    passed := passed + 1;
  end;

  -- 26 duplicate active report denied
  begin
    insert into public.listing_reports (listing_id, reason) values (v_listing_public, 'fraud');
    raise exception 'FAIL 26 duplicate report allowed';
  exception when others then
    if sqlerrm like 'FAIL 26%' then raise; end if;
    passed := passed + 1;
  end;

  -- 27 report rate limit (11th in 24h)
  reset role;
  for i in 1..10 loop
    insert into public.review_abuse_events (user_id, kind, created_at)
    values (v_other, 'listing_report', now() - interval '1 hour');
  end loop;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Report Target XX', 'Report target description long enough', 10, 'Irvine', 'CA'
  ) returning id into v_dummy_listing;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_dummy_listing, v_cat, 'good', 'sell');

  update public.listings set status = 'active' where id = v_dummy_listing;

  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.listing_reports (listing_id, reason) values (v_dummy_listing, 'spam');
    raise exception 'FAIL 27 rate limit not enforced';
  exception when others then
    if sqlerrm like 'FAIL 27%' then raise; end if;
    passed := passed + 1;
  end;

  -- Publish validation checks 28, 35, 36, 37, 38
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Inactive Cat XX', 'Inactive category test description ok', 10, 'Irvine', 'CA'
  ) returning id into v_listing_no_cat;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_no_cat, v_cat_inactive, 'good', 'sell');

  -- 28 inactive category publish denied
  begin
    update public.listings set status = 'active' where id = v_listing_no_cat;
    raise exception 'FAIL 28 inactive category publish allowed';
  exception when others then
    if sqlerrm like 'FAIL 28%' then raise; end if;
    passed := passed + 1;
  end;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'No Detail XX', 'No detail test description long enough', 10, 'Irvine', 'CA'
  ) returning id into v_listing_no_detail;

  -- 35 publish without detail denied
  begin
    update public.listings set status = 'active' where id = v_listing_no_detail;
    raise exception 'FAIL 35 publish without detail allowed';
  exception when others then
    if sqlerrm like 'FAIL 35%' then raise; end if;
    passed := passed + 1;
  end;

  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'No Category XX', 'No category test description long enough', 10, 'Irvine', 'CA'
  ) returning id into v_listing_no_cat;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_no_cat, null, 'good', 'sell');

  -- 36 publish without category denied
  begin
    update public.listings set status = 'active' where id = v_listing_no_cat;
    raise exception 'FAIL 36 publish without category allowed';
  exception when others then
    if sqlerrm like 'FAIL 36%' then raise; end if;
    passed := passed + 1;
  end;

  -- 37 negative price denied (constraint)
  begin
    insert into public.listings (
      listing_type, title, description, price_amount, city, state
    ) values (
      'marketplace_item', 'Bad Price XX', 'Negative price test description ok', -5, 'Irvine', 'CA'
    );
    raise exception 'FAIL 37 negative price allowed';
  exception
    when check_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 37%' then raise; end if;
      passed := passed + 1;
  end;

  -- 38 free price normalization to 0 on publish
  insert into public.listings (
    listing_type, status, visibility, author_visibility,
    title, description, price_amount, city, state
  ) values (
    'marketplace_item', 'draft', 'public', 'public',
    'Free Item XX', 'Free item test description long enough', 99, 'Irvine', 'CA'
  ) returning id into v_listing_free;

  insert into public.marketplace_listing_details (
    listing_id, category_id, condition, transaction_type
  ) values (v_listing_free, v_cat, 'good', 'free');

  update public.listings set status = 'active' where id = v_listing_free;
  select price_amount into price_val from public.listings where id = v_listing_free;
  if price_val is distinct from 0 then raise exception 'FAIL 38 free price normalize: %', price_val; end if;
  passed := passed + 1;

  -- 29 user admin_set_listing_status denied
  begin
    perform public.admin_set_listing_status(v_listing_public, 'removed', 'hack');
    raise exception 'FAIL 29 user admin_set_listing_status allowed';
  exception when others then
    if sqlerrm like 'FAIL 29%' then raise; end if;
    passed := passed + 1;
  end;

  -- 30 business_owner role admin_set_listing_status denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_biz_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_set_listing_status(v_listing_public, 'removed', 'hack');
    raise exception 'FAIL 30 business_owner admin_set_listing_status allowed';
  exception when others then
    if sqlerrm like 'FAIL 30%' then raise; end if;
    passed := passed + 1;
  end;

  -- 31 admin remove works
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_listing_public, 'removed', 'policy');
  select status, moderation_reason into st, reason from public.listings where id = v_listing_public;
  if st is distinct from 'removed' or reason is distinct from 'policy' then
    raise exception 'FAIL 31 admin remove: %/%', st, reason;
  end if;
  passed := passed + 1;

  -- 32 owner restore denied
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.listings set status = 'active' where id = v_listing_public;
    get diagnostics n = row_count;
    select status into st from public.listings where id = v_listing_public;
    if n > 0 or st is distinct from 'removed' then
      raise exception 'FAIL 32 owner restore allowed rows=% status=%', n, st;
    end if;
    passed := passed + 1;
  exception when others then
    if sqlerrm like 'FAIL 32%' then raise; end if;
    passed := passed + 1;
  end;

  -- 33 admin restore works
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_listing_status(v_listing_public, 'active', null);
  select status into st from public.listings where id = v_listing_public;
  if st is distinct from 'active' then raise exception 'FAIL 33 admin restore: %', st; end if;
  passed := passed + 1;

  -- Reserve then complete for checks 34, 39, 40
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.listings set status = 'reserved' where id = v_listing_public;
  update public.listings set status = 'completed' where id = v_listing_public;

  -- 39 completion sets completed_at server-side
  select completed_at into completed_ts from public.listings where id = v_listing_public;
  if completed_ts is null then raise exception 'FAIL 39 completed_at null'; end if;
  passed := passed + 1;

  -- 34 invalid state transition denied (completed → active by user)
  begin
    update public.listings set status = 'active' where id = v_listing_public;
    raise exception 'FAIL 34 completed to active allowed';
  exception when others then
    if sqlerrm like 'FAIL 34%' then raise; end if;
    passed := passed + 1;
  end;

  -- 40 concurrent/stale transition via transition_listing_status with wrong p_from denied
  begin
    perform public.transition_listing_status(v_listing_public, 'active', 'archived');
    raise exception 'FAIL 40 stale transition allowed';
  exception when others then
    if sqlerrm like 'FAIL 40%' then raise; end if;
    passed := passed + 1;
  end;

  -- 41 marketplace_catalog excludes draft/private/unlisted/removed
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into n from public.marketplace_catalog
  where id in (v_listing_draft, v_listing_private, v_listing_unlisted, v_listing_removed);
  if n <> 0 then raise exception 'FAIL 41 catalog leak: %', n; end if;
  select count(*) into n from public.marketplace_catalog where id = v_listing_public;
  if n <> 0 then raise exception 'FAIL 41 completed not in catalog: expected 0 got %', n; end if;
  passed := passed + 1;

  -- 42 username case-insensitive uniqueness
  reset role;
  perform set_config('request.jwt.claim.sub', v_other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set username = upper(uname) where id = v_other;
    raise exception 'FAIL 42 username case dup allowed';
  exception
    when unique_violation then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 42%' then raise; end if;
      if sqlerrm like '%reserved username%' then passed := passed + 1;
      else raise; end if;
  end;

  -- 43 reserved username denied
  begin
    update public.profiles set username = 'admin' where id = v_other;
    raise exception 'FAIL 43 reserved username allowed';
  exception when others then
    if sqlerrm like 'FAIL 43%' then raise; end if;
    passed := passed + 1;
  end;

  -- 44 system profile fields UPDATE denied (role)
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.profiles set role = 'admin' where id = v_owner;
    select role::text into label from public.profiles where id = v_owner;
    if label is distinct from 'user' then raise exception 'FAIL 44 role escalated: %', label; end if;
    passed := passed + 1;
  exception
    when insufficient_privilege then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 44%' then raise; end if;
      if sqlstate = '42501' or sqlerrm ilike '%permission denied%' then
        passed := passed + 1;
      else
        raise;
      end if;
  end;

  -- 45 category mutation denied for authenticated
  begin
    update public.listing_categories set name_ru = 'HACKED' where id = v_cat;
    select name_ru into label from public.listing_categories where id = v_cat;
    if label = 'HACKED' then raise exception 'FAIL 45 category writable'; end if;
    passed := passed + 1;
  exception
    when insufficient_privilege then passed := passed + 1;
    when others then
      if sqlerrm like 'FAIL 45%' then raise; end if;
      passed := passed + 1;
  end;

  raise notice 'LISTINGS RLS CHECKS PASSED: %', passed;
  if passed < 45 then
    raise exception 'Expected at least 45 passes, got %', passed;
  end if;

  -- Visible to Management API clients (NOTICE is often dropped)
  raise exception 'SUCCESS: LISTINGS RLS CHECKS PASSED: %', passed
    using errcode = 'P0001';
end;
$$;

rollback;
