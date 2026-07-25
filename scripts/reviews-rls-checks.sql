-- Full reviews security + scenario suite (remote Supabase).
-- Single transaction; ROLLBACK. Requires reviews migrations.

begin;

do $$
declare
  v_cat uuid := gen_random_uuid();
  v_biz uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_user_c uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_review uuid;
  v_session uuid;
  v_review_b uuid;
  v_session_b uuid;
  v_review_c uuid;
  v_reply uuid;
  v_report uuid;
  n int;
  st text;
  lvl text;
  r jsonb;
  avg_r numeric;
  cnt int;
  ai_cnt int;
  tx_cnt int;
  rem_first timestamptz;
  rem_second timestamptz;
  rem_final timestamptz;
  exp_at timestamptz;
  started timestamptz;
  passed int := 0;
  err text;
begin
  -- helpers as nested blocks via labels
  insert into public.categories (id, slug, name, sort_order, is_active)
  values (v_cat, 'sec-' || substr(v_biz::text,1,8), 'Sec Cat', 999, true);

  insert into public.businesses (id, slug, category_id, name, status)
  values (v_biz, 'sec-biz-' || substr(v_biz::text,1,8), v_cat, 'Sec Biz', 'approved');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous)
  values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seca-'||substr(v_user_a::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now()-interval '3 days', now()-interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'secb-'||substr(v_user_b::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now()-interval '3 days', now()-interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_user_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'secc-'||substr(v_user_c::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now()-interval '3 days', now()-interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_owner,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seco-'||substr(v_owner::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now()-interval '3 days', now()-interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false),
    (v_admin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'secadm-'||substr(v_admin::text,1,8)||'@example.com', crypt('x', gen_salt('bf')), now()-interval '3 days', now()-interval '3 days', now(), '{}'::jsonb, '{}'::jsonb, false, false, false);

  insert into public.profiles (id, display_name, role, created_at)
  values
    (v_user_a, 'A', 'user', now()-interval '3 days'),
    (v_user_b, 'B', 'user', now()-interval '3 days'),
    (v_user_c, 'C', 'user', now()-interval '3 days'),
    (v_owner, 'O', 'business_owner', now()-interval '3 days'),
    (v_admin, 'Admin', 'admin', now()-interval '3 days')
  on conflict (id) do update
    set role = excluded.role, created_at = excluded.created_at, display_name = excluded.display_name;

  insert into public.business_owners (business_id, user_id, role)
  values (v_biz, v_owner, 'owner');

  -- login user_a
  reset role;
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.reviews (business_id, rating, body)
  values (v_biz, 5, 'Отличный сервис и прекрасная еда, очень рекомендую всем друзьям')
  returning id into v_review;
  select moderation_status::text into st from public.reviews where id = v_review;
  if st is distinct from 'verification_pending' then raise exception 'FAIL create_review_pending: %', st; end if;
  passed := passed + 1;

  perform set_config('app.review_trusted_write', '1', true);
  begin
    update public.reviews set moderation_status = 'published', verification_level = 'ai_verified' where id = v_review;
  exception when others then null;
  end;
  select moderation_status::text into st from public.reviews where id = v_review;
  if st is distinct from 'verification_pending' then raise exception 'FAIL guc_cannot_publish: %', st; end if;
  passed := passed + 1;

  begin
    perform private.enable_trusted_review_write();
    raise exception 'FAIL private_enable_denied: expected error';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  v_session := (select id from public.create_verification_session(v_review));
  if v_session is null then raise exception 'FAIL session_created'; end if;
  passed := passed + 1;

  select started_at, expires_at into started, exp_at from public.review_verification_sessions where id = v_session;
  if not (exp_at between started + interval '71 hours 50 minutes' and started + interval '72 hours 10 minutes') then
    raise exception 'FAIL expiration_72h: %', exp_at;
  end if;
  passed := passed + 1;

  select
    max(scheduled_for) filter (where reminder_type='first'),
    max(scheduled_for) filter (where reminder_type='second'),
    max(scheduled_for) filter (where reminder_type='final')
  into rem_first, rem_second, rem_final
  from public.review_verification_reminders where session_id = v_session;

  if not (rem_first between started + interval '5 hours 50 minutes' and started + interval '6 hours 10 minutes') then
    raise exception 'FAIL reminder_first_6h: %', rem_first;
  end if;
  passed := passed + 1;
  if not (rem_second between started + interval '23 hours 50 minutes' and started + interval '24 hours 10 minutes') then
    raise exception 'FAIL reminder_second_24h: %', rem_second;
  end if;
  passed := passed + 1;
  if not (rem_final between started + interval '47 hours 50 minutes' and started + interval '48 hours 10 minutes') then
    raise exception 'FAIL reminder_final_48h: %', rem_final;
  end if;
  passed := passed + 1;

  begin
    insert into public.review_verification_messages(session_id,role,body,sequence_number)
    values (v_session,'agent','x',99);
    raise exception 'FAIL direct_agent_insert_denied';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  -- user_b cannot see transcript
  reset role;
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.review_verification_messages where session_id = v_session;
  if n <> 0 then raise exception 'FAIL user_b_no_messages: %', n; end if;
  passed := passed + 1;
  select count(*) into n from public.review_verification_sessions where id = v_session;
  if n <> 0 then raise exception 'FAIL user_b_no_session: %', n; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.review_verification_messages where session_id = v_session;
  if n <> 0 then raise exception 'FAIL owner_no_transcript: %', n; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into n from public.reviews where id = v_review;
  if n <> 0 then raise exception 'FAIL anon_hides_unpublished: %', n; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_verification_answer(v_session, 'Я покупал ужин вчера вечером тут');
    raise exception 'FAIL foreign_session_submit';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.complete_verification_session(v_session);
    raise exception 'FAIL complete_before_answers';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  r := public.submit_verification_answer(v_session, 'Заказывал семейный ужин и десерты в зале');
  r := public.submit_verification_answer(v_session, 'Примерно две недели назад в субботу вечером');
  r := public.submit_verification_answer(v_session, 'Больше всего понравился сервис и чистота');
  if not coalesce((r->>'complete')::boolean, false) then raise exception 'FAIL verify_complete_flag: %', r; end if;
  passed := passed + 1;
  if r->>'outcome' is distinct from 'published' then raise exception 'FAIL verify_outcome_published: %', r; end if;
  passed := passed + 1;

  select moderation_status::text, verification_level::text into st, lvl from public.reviews where id = v_review;
  if not (st='published' and lvl='ai_verified') then raise exception 'FAIL published_ai_verified: %/%', st, lvl; end if;
  passed := passed + 1;

  r := public.complete_verification_session(v_session);
  if not coalesce((r->>'complete')::boolean, false) then raise exception 'FAIL complete_idempotent: %', r; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  select count(*) into n from public.reviews where id = v_review;
  if n <> 1 then raise exception 'FAIL anon_sees_published: %', n; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.reviews set body='owner overwrite attempt text xx' where id=v_review;
    -- if update affects 0 rows due to RLS, treat as pass
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL owner_cannot_update_review: updated %', n; end if;
    passed := passed + 1;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;
  begin
    delete from public.reviews where id=v_review;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL owner_cannot_delete_review'; end if;
    passed := passed + 1;
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  insert into public.review_replies (review_id, body)
  values (v_review, 'Спасибо за отзыв! Рады видеть вас снова.')
  returning id into v_reply;
  if v_reply is null then raise exception 'FAIL owner_reply_created'; end if;
  passed := passed + 1;

  begin
    update public.businesses set rating_avg=5, reviews_count=9, ai_verified_reviews_count=9, transaction_verified_reviews_count=9 where id=v_biz;
    raise exception 'FAIL client_cannot_set_aggregates';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.refresh_business_rating(v_biz);
    raise exception 'FAIL refresh_exec_denied';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.review_reports (review_id, reason, details)
  values (v_review, 'spam', 'похоже на рекламу')
  returning id into v_report;
  if v_report is null then raise exception 'FAIL report_created'; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_set_review_moderation(v_review,'hidden',null);
    raise exception 'FAIL owner_not_admin';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_report_status(v_report, 'dismissed');
  passed := passed + 1;

  if public.review_level_weight('unverified') is distinct from 0.5 then raise exception 'FAIL weight_unverified'; end if;
  passed := passed + 1;
  if public.review_level_weight('ai_verified') is distinct from 1.0 then raise exception 'FAIL weight_ai'; end if;
  passed := passed + 1;
  if public.review_level_weight('transaction_verified') is distinct from 1.5 then raise exception 'FAIL weight_tx'; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.reviews(business_id,rating,body) values (v_biz,4, repeat('ещё один текст отзыва тут ',3));
    raise exception 'FAIL second_review_blocked';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  -- manual_review path
  reset role;
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reviews (business_id, rating, body)
  values (v_biz, 5, 'Отличный сервис прекрасный профессионал очень рекомендую качество')
  returning id into v_review_b;
  v_session_b := (select id from public.create_verification_session(v_review_b));
  r := public.submit_verification_answer(v_session_b, 'На самом деле я тут не был и ничего не покупал');
  r := public.submit_verification_answer(v_session_b, 'Это выдуманный фейк отзыв для проверки');
  r := public.submit_verification_answer(v_session_b, 'Я не пользовался услугами этого места вовсе');
  if r->>'outcome' is distinct from 'manual_review' then raise exception 'FAIL manual_review_outcome: %', r; end if;
  passed := passed + 1;
  select moderation_status::text into st from public.reviews where id = v_review_b;
  if st is distinct from 'manual_review' then raise exception 'FAIL manual_review_status: %', st; end if;
  passed := passed + 1;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  select count(*) into n from public.reviews where id = v_review_b;
  if n <> 0 then raise exception 'FAIL anon_hides_manual_review: %', n; end if;
  passed := passed + 1;

  -- expiration
  reset role;
  perform set_config('request.jwt.claim.sub', v_user_c::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_c::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.reviews (business_id, rating, body)
  values (v_biz, 4, 'Нормально в целом понравилось обслуживание и еда была вкусная')
  returning id into v_review_c;
  v_session := (select id from public.create_verification_session(v_review_c));

  reset role;
  perform private.enable_trusted_review_write();
  update public.review_verification_sessions set expires_at = now() - interval '1 minute' where id = v_session;
  perform private.disable_trusted_review_write();

  perform set_config('request.jwt.claim.sub', v_user_c::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_c::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_verification_answer(v_session, 'Поздний ответ который уже нельзя отправить');
    raise exception 'FAIL submit_after_expire';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;
  begin
    perform public.expire_stale_verifications();
    raise exception 'FAIL non_admin_expire';
  exception when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    passed := passed + 1;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.expire_stale_verifications();
  passed := passed + 1;
  select moderation_status::text into st from public.reviews where id = v_review_c;
  if st is distinct from 'expired' then raise exception 'FAIL expired_review_status: %', st; end if;
  passed := passed + 1;

  -- weighted rating
  reset role;
  perform private.enable_trusted_review_write();
  update public.reviews set moderation_status='hidden' where id=v_review_b;
  update public.reviews
  set moderation_status='published', verification_level='unverified', rating=1, published_at=now()
  where id=v_review_c;
  update public.reviews
  set verification_level='transaction_verified', rating=5
  where id=v_review;
  perform private.disable_trusted_review_write();
  perform public.refresh_business_rating(v_biz);

  select rating_avg, reviews_count, ai_verified_reviews_count, transaction_verified_reviews_count
  into avg_r, cnt, ai_cnt, tx_cnt from public.businesses where id = v_biz;
  if avg_r is distinct from 4.00 then raise exception 'FAIL weighted_avg: %', avg_r; end if;
  passed := passed + 1;
  if cnt is distinct from 2 then raise exception 'FAIL weighted_count: %', cnt; end if;
  passed := passed + 1;
  if tx_cnt is distinct from 1 then raise exception 'FAIL tx_count: %', tx_cnt; end if;
  passed := passed + 1;
  if ai_cnt is distinct from 0 then raise exception 'FAIL ai_count_zero_here: %', ai_cnt; end if;
  passed := passed + 1;

  perform private.enable_trusted_review_write();
  update public.reviews set moderation_status='hidden' where id=v_review;
  perform private.disable_trusted_review_write();
  perform public.refresh_business_rating(v_biz);
  select rating_avg, reviews_count into avg_r, cnt from public.businesses where id=v_biz;
  if avg_r is distinct from 1.00 then raise exception 'FAIL after_hide_avg: %', avg_r; end if;
  passed := passed + 1;
  if cnt is distinct from 1 then raise exception 'FAIL after_hide_count: %', cnt; end if;
  passed := passed + 1;

  perform private.enable_trusted_review_write();
  update public.reviews set moderation_status='rejected' where id=v_review_c;
  perform private.disable_trusted_review_write();
  perform public.refresh_business_rating(v_biz);
  select rating_avg, reviews_count, ai_verified_reviews_count, transaction_verified_reviews_count
  into avg_r, cnt, ai_cnt, tx_cnt from public.businesses where id=v_biz;
  if avg_r is distinct from 0 then raise exception 'FAIL no_published_avg_zero: %', avg_r; end if;
  passed := passed + 1;
  if cnt is distinct from 0 then raise exception 'FAIL no_published_count_zero: %', cnt; end if;
  passed := passed + 1;
  if ai_cnt is distinct from 0 then raise exception 'FAIL no_published_ai_zero: %', ai_cnt; end if;
  passed := passed + 1;
  if tx_cnt is distinct from 0 then raise exception 'FAIL no_published_tx_zero: %', tx_cnt; end if;
  passed := passed + 1;

  raise exception 'ALL_PASSED:%', passed;
end;
$$;

rollback;
