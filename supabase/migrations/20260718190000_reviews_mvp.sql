-- Migration: reviews_mvp (trust levels + mandatory AI verification)
-- НЕ применять без отдельного подтверждения.
--
-- Продуктовые решения MVP:
--   * новый отзыв: moderation_status = verification_pending (не публичный);
--   * публикация только после AI-интервью (ai_verified) или решения админа;
--   * «удаление» = soft-delete (moderation_status = hidden) через RPC;
--   * LLM пока rule-based; интерфейс готов к замене API.

-- ============ ENUMS ============
create type review_moderation_status as enum (
  'verification_pending',
  'verification_in_progress',
  'manual_review',
  'published',
  'rejected',
  'hidden',
  'expired'
);

create type review_verification_level as enum (
  'unverified',
  'ai_verified',
  'transaction_verified'
);

create type review_verification_session_status as enum (
  'pending',
  'in_progress',
  'completed',
  'manual_review',
  'expired'
);

create type review_verification_message_role as enum (
  'agent',
  'user',
  'system'
);

create type review_reminder_type as enum (
  'first',
  'second',
  'final'
);

create type review_reminder_status as enum (
  'pending',
  'sent',
  'cancelled'
);

create type review_report_status as enum ('open', 'reviewed', 'dismissed');
create type review_report_reason as enum (
  'spam',
  'offensive',
  'fake',
  'off_topic',
  'other'
);

-- ============ BUSINESS AGGREGATES ============
alter table public.businesses
  add column if not exists ai_verified_reviews_count integer not null default 0,
  add column if not exists transaction_verified_reviews_count integer not null default 0;

-- ============ HELPERS ============
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

create or replace function public.owns_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.business_owners bo
    where bo.business_id = p_business_id
      and bo.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.owns_business(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.owns_business(uuid) to authenticated;

-- ============ TRUSTED WRITE (NOT client-settable) ============
-- Do NOT trust app.* GUCs: any role can call set_config().
-- Only SECURITY DEFINER RPCs in this migration may call private.enable_*.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;
grant usage on schema private to postgres;

create table if not exists private.review_trusted_tx (
  txid bigint primary key,
  created_at timestamptz not null default now()
);

revoke all on table private.review_trusted_tx from public;
revoke all on table private.review_trusted_tx from anon, authenticated;

create or replace function private.enable_trusted_review_write()
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  delete from private.review_trusted_tx
  where created_at < now() - interval '1 day';

  insert into private.review_trusted_tx (txid)
  values (txid_current())
  on conflict (txid) do nothing;
end;
$$;

create or replace function private.disable_trusted_review_write()
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  delete from private.review_trusted_tx where txid = txid_current();
end;
$$;

create or replace function private.has_trusted_review_write()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select exists (
    select 1
    from private.review_trusted_tx t
    where t.txid = txid_current()
  );
$$;

revoke all on function private.enable_trusted_review_write() from public;
revoke all on function private.enable_trusted_review_write() from anon, authenticated;
revoke all on function private.disable_trusted_review_write() from public;
revoke all on function private.disable_trusted_review_write() from anon, authenticated;
revoke all on function private.has_trusted_review_write() from public;
revoke all on function private.has_trusted_review_write() from anon, authenticated;
-- Trigger/RPC owners (postgres) retain execute by virtue of ownership.


create or replace function public.review_level_weight(p_level review_verification_level)
returns numeric
language sql
immutable
as $$
  select case p_level
    when 'unverified' then 0.5
    when 'ai_verified' then 1.0
    when 'transaction_verified' then 1.5
  end;
$$;

-- ============ REVIEWS ============
create table public.reviews (
  id                         uuid primary key default gen_random_uuid(),
  business_id                uuid not null references public.businesses(id) on delete cascade,
  user_id                    uuid not null references public.profiles(id) on delete cascade,
  rating                     integer not null check (rating >= 1 and rating <= 5),
  body                       text not null,
  moderation_status          review_moderation_status not null default 'verification_pending',
  verification_level         review_verification_level not null default 'unverified',
  verification_score         numeric(5,2),
  verification_summary       text,
  verification_completed_at  timestamptz,
  transaction_verified_at     timestamptz,
  published_at               timestamptz,
  expires_at                 timestamptz,
  author_display_name        text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint reviews_body_length_chk check (
    char_length(btrim(body)) >= 20
    and char_length(body) <= 3000
  ),
  constraint reviews_one_per_user_business unique (business_id, user_id)
);

create index reviews_business_moderation_idx
  on public.reviews (business_id, moderation_status);
create index reviews_user_idx on public.reviews (user_id);
create index reviews_moderation_idx on public.reviews (moderation_status);
create index reviews_verification_level_idx on public.reviews (verification_level);

-- ============ VERIFICATION SESSIONS ============
create table public.review_verification_sessions (
  id                     uuid primary key default gen_random_uuid(),
  review_id              uuid not null unique references public.reviews(id) on delete cascade,
  user_id                uuid not null references public.profiles(id) on delete cascade,
  status                 review_verification_session_status not null default 'pending',
  current_question_index integer not null default 0,
  questions_required     integer not null default 3 check (questions_required between 2 and 5),
  score                  numeric(5,2),
  result_summary         text,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  expires_at             timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index review_verification_sessions_user_idx
  on public.review_verification_sessions (user_id, status);
create index review_verification_sessions_expires_idx
  on public.review_verification_sessions (expires_at)
  where status in ('pending', 'in_progress');

-- ============ VERIFICATION MESSAGES ============
create table public.review_verification_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.review_verification_sessions(id) on delete cascade,
  role            review_verification_message_role not null,
  body            text not null,
  question_type   text,
  sequence_number integer not null,
  created_at      timestamptz not null default now(),
  constraint review_verification_messages_seq_unique unique (session_id, sequence_number),
  constraint review_verification_messages_body_chk check (
    char_length(btrim(body)) >= 1
    and char_length(body) <= 4000
  )
);

create index review_verification_messages_session_idx
  on public.review_verification_messages (session_id, sequence_number);

-- ============ REMINDERS (scheduler-ready, no email yet) ============
create table public.review_verification_reminders (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.review_verification_sessions(id) on delete cascade,
  reminder_type review_reminder_type not null,
  scheduled_for timestamptz not null,
  sent_at       timestamptz,
  status        review_reminder_status not null default 'pending',
  created_at    timestamptz not null default now(),
  constraint review_verification_reminders_unique unique (session_id, reminder_type)
);

create index review_verification_reminders_due_idx
  on public.review_verification_reminders (status, scheduled_for)
  where status = 'pending';

-- ============ REVIEW REPLIES ============
create table public.review_replies (
  id             uuid primary key default gen_random_uuid(),
  review_id      uuid not null references public.reviews(id) on delete cascade,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint review_replies_one_per_review unique (review_id),
  constraint review_replies_body_length_chk check (
    char_length(btrim(body)) >= 1
    and char_length(body) <= 2000
  )
);

create index review_replies_business_idx on public.review_replies (business_id);

-- ============ REVIEW REPORTS ============
create table public.review_reports (
  id               uuid primary key default gen_random_uuid(),
  review_id        uuid not null references public.reviews(id) on delete cascade,
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reason           review_report_reason not null,
  details          text,
  status           review_report_status not null default 'open',
  created_at       timestamptz not null default now(),
  constraint review_reports_one_per_reporter unique (review_id, reporter_user_id),
  constraint review_reports_details_length_chk check (
    details is null or char_length(details) <= 1000
  )
);

create index review_reports_status_idx on public.review_reports (status);
create index review_reports_review_idx on public.review_reports (review_id);

-- ============ ABUSE EVENT LOG ============
create table public.review_abuse_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('review_write', 'review_report')),
  created_at timestamptz not null default now()
);

create index review_abuse_events_user_kind_idx
  on public.review_abuse_events (user_id, kind, created_at desc);

alter table public.review_abuse_events enable row level security;
-- No policies for anon/authenticated → inaccessible via PostgREST.

-- ============ updated_at triggers ============
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

create trigger review_replies_set_updated_at
  before update on public.review_replies
  for each row execute function public.set_updated_at();

create trigger review_verification_sessions_set_updated_at
  before update on public.review_verification_sessions
  for each row execute function public.set_updated_at();

-- ============ Rate-limit helpers ============
create or replace function public.assert_review_write_rate_limit()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select count(*) into n
  from public.review_abuse_events e
  where e.user_id = uid
    and e.kind = 'review_write'
    and e.created_at > now() - interval '1 hour';

  if n >= 3 then
    raise exception 'review write rate limit exceeded (max 3 per hour)'
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.assert_review_report_rate_limit()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select count(*) into n
  from public.review_abuse_events e
  where e.user_id = uid
    and e.kind = 'review_report'
    and e.created_at > now() - interval '24 hours';

  if n >= 10 then
    raise exception 'review report rate limit exceeded (max 10 per day)'
      using errcode = 'P0001';
  end if;
end;
$$;

grant execute on function public.assert_review_write_rate_limit() to authenticated;
grant execute on function public.assert_review_report_rate_limit() to authenticated;

-- ============ BEFORE INSERT/UPDATE reviews: force safe fields ============
create or replace function public.reviews_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  account_created_at timestamptz;
  trusted boolean := private.has_trusted_review_write();
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;

    new.user_id := (select auth.uid());
    new.verification_level := 'unverified';
    new.verification_score := null;
    new.verification_summary := null;
    new.verification_completed_at := null;
    new.transaction_verified_at := null;
    new.published_at := null;

    -- Even admins must use trusted RPC to insert non-pending rows.
    if not trusted then
      new.moderation_status := 'verification_pending';
    end if;

    select p.created_at, p.display_name
    into account_created_at, new.author_display_name
    from public.profiles p
    where p.id = new.user_id;

    if account_created_at is null then
      raise exception 'profile required' using errcode = '42501';
    end if;

    if account_created_at > now() - interval '24 hours' then
      raise exception 'account must be at least 24 hours old to leave a review'
        using errcode = 'P0001';
    end if;

    if public.owns_business(new.business_id) then
      raise exception 'business owners cannot review their own business'
        using errcode = 'P0001';
    end if;

  elsif tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.business_id := old.business_id;
    new.author_display_name := old.author_display_name;

    -- Trust ONLY private.review_trusted_tx token set by our SECURITY DEFINER RPCs.
    -- set_config('app.review_trusted_write', ...) from the client is IGNORED.
    if trusted then
      if new.moderation_status = 'published'
         and old.moderation_status is distinct from 'published' then
        new.published_at := coalesce(new.published_at, now());
      end if;
      if new.verification_level = 'transaction_verified'
         and old.verification_level is distinct from 'transaction_verified' then
        new.transaction_verified_at := coalesce(new.transaction_verified_at, now());
      end if;
    else
      -- Client / non-trusted path cannot escalate trust or publish.
      new.moderation_status := old.moderation_status;
      new.verification_level := old.verification_level;
      new.verification_score := old.verification_score;
      new.verification_summary := old.verification_summary;
      new.verification_completed_at := old.verification_completed_at;
      new.transaction_verified_at := old.transaction_verified_at;
      new.published_at := old.published_at;
      new.expires_at := old.expires_at;
    end if;
  end if;

  new.body := btrim(new.body);
  return new;
end;
$$;

create trigger reviews_enforce_row
  before insert or update on public.reviews
  for each row execute function public.reviews_enforce_row();

create or replace function public.reviews_log_write_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.review_abuse_events (user_id, kind)
  values (coalesce(new.user_id, old.user_id), 'review_write');
  return coalesce(new, old);
end;
$$;

create trigger reviews_log_write_event
  after insert or update of rating, body on public.reviews
  for each row execute function public.reviews_log_write_event();

create or replace function public.reviews_rate_limit_before_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT'
       or new.rating is distinct from old.rating
       or new.body is distinct from old.body then
      perform public.assert_review_write_rate_limit();
    end if;
  end if;
  return new;
end;
$$;

create trigger reviews_rate_limit_before_write
  before insert or update on public.reviews
  for each row execute function public.reviews_rate_limit_before_write();

-- ============ Weighted rating recalculation ============
create or replace function public.refresh_business_rating(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_avg numeric;
  v_count integer;
  v_ai integer;
  v_tx integer;
begin
  select
    coalesce(
      round(
        (sum(r.rating * public.review_level_weight(r.verification_level))
          / nullif(sum(public.review_level_weight(r.verification_level)), 0)
        )::numeric,
        2
      ),
      0
    ),
    coalesce(count(*)::integer, 0),
    coalesce(
      count(*) filter (where r.verification_level = 'ai_verified')::integer,
      0
    ),
    coalesce(
      count(*) filter (where r.verification_level = 'transaction_verified')::integer,
      0
    )
  into v_avg, v_count, v_ai, v_tx
  from public.reviews r
  where r.business_id = p_business_id
    and r.moderation_status = 'published';

  update public.businesses b
  set
    rating_avg = coalesce(v_avg, 0),
    reviews_count = coalesce(v_count, 0),
    ai_verified_reviews_count = coalesce(v_ai, 0),
    transaction_verified_reviews_count = coalesce(v_tx, 0)
  where b.id = p_business_id;
end;
$$;

create or replace function public.reviews_refresh_rating_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  bid uuid := coalesce(new.business_id, old.business_id);
begin
  perform public.refresh_business_rating(bid);
  if tg_op = 'UPDATE'
     and old.business_id is distinct from new.business_id then
    perform public.refresh_business_rating(old.business_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger reviews_refresh_rating
  after insert
     or update of rating, moderation_status, verification_level, business_id
     or delete
  on public.reviews
  for each row execute function public.reviews_refresh_rating_trigger();

-- ============ Reply / report enforcement ============
create or replace function public.review_replies_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  review_business uuid;
  review_mod review_moderation_status;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select r.business_id, r.moderation_status
  into review_business, review_mod
  from public.reviews r
  where r.id = new.review_id;

  if review_business is null then
    raise exception 'review not found' using errcode = 'P0001';
  end if;

  if review_mod is distinct from 'published' and not public.is_admin() then
    raise exception 'can only reply to published reviews' using errcode = 'P0001';
  end if;

  new.business_id := review_business;
  new.author_user_id := (select auth.uid());
  new.body := btrim(new.body);

  if not public.owns_business(new.business_id) and not public.is_admin() then
    raise exception 'only business owner can reply' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger review_replies_enforce_row
  before insert or update on public.review_replies
  for each row execute function public.review_replies_enforce_row();

create or replace function public.review_reports_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  review_owner uuid;
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;

    new.reporter_user_id := (select auth.uid());
    new.status := 'open';

    select r.user_id into review_owner
    from public.reviews r
    where r.id = new.review_id
      and r.moderation_status = 'published';

    if review_owner is null then
      raise exception 'review not found' using errcode = 'P0001';
    end if;

    if review_owner = new.reporter_user_id then
      raise exception 'cannot report your own review' using errcode = 'P0001';
    end if;

    perform public.assert_review_report_rate_limit();
  elsif tg_op = 'UPDATE' then
    if not public.is_admin() then
      raise exception 'admin only' using errcode = '42501';
    end if;
    new.review_id := old.review_id;
    new.reporter_user_id := old.reporter_user_id;
    new.reason := old.reason;
  end if;

  return new;
end;
$$;

create trigger review_reports_enforce_row
  before insert or update on public.review_reports
  for each row execute function public.review_reports_enforce_row();

create or replace function public.review_reports_log_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.review_abuse_events (user_id, kind)
  values (new.reporter_user_id, 'review_report');
  return new;
end;
$$;

create trigger review_reports_log_event
  after insert on public.review_reports
  for each row execute function public.review_reports_log_event();

-- Messages: immutable; agent/system/user inserts only via trusted RPCs.
create or replace function public.review_verification_messages_enforce()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  trusted boolean := private.has_trusted_review_write();
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    -- Even admins must use a trusted RPC (no direct REST mutation).
    if not trusted then
      raise exception 'verification messages are immutable' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- INSERT: only trusted SECURITY DEFINER RPCs (token), never client set_config.
  if not trusted then
    raise exception 'verification messages can only be written by verification RPCs'
      using errcode = '42501';
  end if;

  if new.role = 'user' then
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.review_verification_sessions s
      where s.id = new.session_id
        and s.user_id = (select auth.uid())
    ) and not public.is_admin() then
      raise exception 'not your session' using errcode = '42501';
    end if;
  end if;

  new.body := btrim(new.body);
  return new;
end;
$$;

create trigger review_verification_messages_enforce
  before insert or update or delete on public.review_verification_messages
  for each row execute function public.review_verification_messages_enforce();

-- ============ Rule-based answer quality (SQL, used by complete RPC) ============
create or replace function public.verification_answer_is_substantive(p_answer text)
returns boolean
language plpgsql
immutable
as $$
declare
  t text := lower(btrim(coalesce(p_answer, '')));
  letters text;
begin
  if char_length(t) < 5 or char_length(t) > 1500 then
    return false;
  end if;

  -- Too few letters (emoji / punctuation spam)
  letters := regexp_replace(t, '[^a-zа-яё0-9]', '', 'g');
  if char_length(letters) < 4 then
    return false;
  end if;

  if t in ('да', 'нет', 'ok', 'ок', 'хорошо', 'нормально', 'хз', 'не знаю', 'asdf', 'qwerty') then
    return false;
  end if;

  if t ~ '^(.)\1{4,}$' then
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.verification_looks_contradictory(
  p_review_body text,
  p_answers text[]
)
returns boolean
language plpgsql
stable
as $$
declare
  body_l text := lower(coalesce(p_review_body, ''));
  ans text;
  joined text;
  positive boolean;
  denial boolean;
begin
  joined := lower(array_to_string(p_answers, ' '));

  positive := body_l ~ '(отличн|прекрасн|рекоменд|супер|любл|нравит|качеств|профессионал)';
  denial := joined ~ '(не (был|была|покупал|заказывал|ходил|пользовался)|ничего не|не получал|выдумал|фейк)';

  if positive and denial then
    return true;
  end if;

  -- Near-duplicate answers
  if array_length(p_answers, 1) >= 2 then
    if lower(btrim(p_answers[1])) = lower(btrim(p_answers[2])) then
      return true;
    end if;
  end if;
  if array_length(p_answers, 1) >= 3 then
    if lower(btrim(p_answers[2])) = lower(btrim(p_answers[3])) then
      return true;
    end if;
  end if;

  foreach ans in array p_answers loop
    if not public.verification_answer_is_substantive(ans) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- ============ Core verification RPCs ============
create or replace function public.create_verification_session(p_review_id uuid)
returns public.review_verification_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  uid uuid := (select auth.uid());
  rev public.reviews%rowtype;
  sess public.review_verification_sessions%rowtype;
  q1 text := 'Что именно вы покупали или какую услугу получили?';
  q2 text := 'Примерно когда это произошло?';
  q3 text;
  body_snip text;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into rev from public.reviews where id = p_review_id for update;
  if not found then
    raise exception 'review not found' using errcode = 'P0001';
  end if;
  if rev.user_id <> uid and not public.is_admin() then
    raise exception 'not your review' using errcode = '42501';
  end if;
  if rev.moderation_status not in ('verification_pending', 'verification_in_progress') then
    raise exception 'review is not awaiting verification' using errcode = 'P0001';
  end if;

  select * into sess
  from public.review_verification_sessions
  where review_id = p_review_id;

  if found then
    if sess.status in ('expired') then
      raise exception 'verification session expired' using errcode = 'P0001';
    end if;
    return sess;
  end if;

  body_snip := left(btrim(rev.body), 80);
  q3 := format(
    'Вы написали: «%s%s». Уточните, что повлияло на вашу оценку больше всего?',
    body_snip,
    case when char_length(btrim(rev.body)) > 80 then '…' else '' end
  );

  perform private.enable_trusted_review_write();

  insert into public.review_verification_sessions (
    review_id, user_id, status, current_question_index, questions_required,
    started_at, expires_at
  ) values (
    p_review_id, uid, 'in_progress', 0, 3,
    now(), now() + interval '72 hours'
  )
  returning * into sess;

  insert into public.review_verification_messages (session_id, role, body, question_type, sequence_number)
  values
    (sess.id, 'system',
     'Проверка обычно занимает меньше минуты. Ответьте на 3 коротких вопроса.',
     'intro', 1),
    (sess.id, 'agent', q1, 'purchase_or_service', 2),
    (sess.id, 'agent', q2, 'timeframe', 3),
    (sess.id, 'agent', q3, 'clarifying', 4);

  insert into public.review_verification_reminders (session_id, reminder_type, scheduled_for, status)
  values
    (sess.id, 'first',  now() + interval '6 hours',  'pending'),
    (sess.id, 'second', now() + interval '24 hours', 'pending'),
    (sess.id, 'final',  now() + interval '48 hours', 'pending');

  update public.reviews
  set
    moderation_status = 'verification_in_progress',
    expires_at = sess.expires_at,
    updated_at = now()
  where id = p_review_id;

  perform private.disable_trusted_review_write();
  return sess;
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;

create or replace function public.complete_verification_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  uid uuid := (select auth.uid());
  sess public.review_verification_sessions%rowtype;
  rev public.reviews%rowtype;
  answers text[];
  answered integer;
  contradictory boolean;
  v_score numeric(5,2);
  v_summary text;
  outcome text;
  result jsonb;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into sess
  from public.review_verification_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session not found' using errcode = 'P0001';
  end if;
  if sess.user_id <> uid and not public.is_admin() then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if sess.status in ('completed', 'manual_review') then
    return jsonb_build_object(
      'outcome', case when sess.status = 'completed' then 'published' else 'manual_review' end,
      'score', sess.score,
      'summary', sess.result_summary,
      'complete', true
    );
  end if;
  if sess.status = 'expired' or sess.expires_at <= now() then
    raise exception 'verification session expired' using errcode = 'P0001';
  end if;
  if sess.status not in ('pending', 'in_progress') then
    raise exception 'session is not active' using errcode = 'P0001';
  end if;

  perform private.enable_trusted_review_write();

  select * into rev from public.reviews where id = sess.review_id for update;

  if rev.user_id <> uid and not public.is_admin() then
    raise exception 'not your review' using errcode = '42501';
  end if;

  select array_agg(m.body order by m.sequence_number), count(*)::integer
  into answers, answered
  from public.review_verification_messages m
  where m.session_id = sess.id and m.role = 'user';

  if answered is null or answered < sess.questions_required then
    raise exception 'not all questions answered' using errcode = 'P0001';
  end if;

  contradictory := public.verification_looks_contradictory(rev.body, answers);

  -- Completeness/consistency score only — never truthfulness claims.
  if contradictory then
    v_score := 45;
    v_summary := 'Ответы неполные или противоречат тексту отзыва. Требуется ручная проверка.';
    outcome := 'manual_review';
  else
    v_score := 82;
    v_summary := 'Ответы достаточно полные и последовательные для AI-подтверждения. Истинность отзыва не оценивалась.';
    outcome := 'published';
  end if;

  if outcome = 'published' then
    update public.review_verification_sessions
    set
      status = 'completed',
      score = v_score,
      result_summary = v_summary,
      completed_at = now(),
      current_question_index = sess.questions_required,
      updated_at = now()
    where id = sess.id
      and status in ('pending', 'in_progress');

    if not found then
      raise exception 'session already finalized' using errcode = 'P0001';
    end if;

    update public.reviews
    set
      moderation_status = 'published',
      verification_level = 'ai_verified',
      verification_score = v_score,
      verification_summary = v_summary,
      verification_completed_at = now(),
      published_at = now(),
      updated_at = now()
    where id = rev.id
      and moderation_status in ('verification_pending', 'verification_in_progress');

    update public.review_verification_reminders
    set status = 'cancelled'
    where session_id = sess.id and status = 'pending';
  else
    update public.review_verification_sessions
    set
      status = 'manual_review',
      score = v_score,
      result_summary = v_summary,
      completed_at = now(),
      current_question_index = sess.questions_required,
      updated_at = now()
    where id = sess.id
      and status in ('pending', 'in_progress');

    if not found then
      raise exception 'session already finalized' using errcode = 'P0001';
    end if;

    update public.reviews
    set
      moderation_status = 'manual_review',
      verification_score = v_score,
      verification_summary = v_summary,
      verification_completed_at = now(),
      updated_at = now()
    where id = rev.id
      and moderation_status in ('verification_pending', 'verification_in_progress');

    update public.review_verification_reminders
    set status = 'cancelled'
    where session_id = sess.id and status = 'pending';
  end if;

  insert into public.review_verification_messages (
    session_id, role, body, question_type, sequence_number
  )
  select
    sess.id,
    'system',
    case when outcome = 'published'
      then 'Проверка завершена. Отзыв подтверждён и опубликован.'
      else 'Проверка завершена. Отзыв отправлен на дополнительную проверку.'
    end,
    'completion',
    coalesce(max(sequence_number), 0) + 1
  from public.review_verification_messages
  where session_id = sess.id;

  result := jsonb_build_object(
    'outcome', outcome,
    'score', v_score,
    'summary', v_summary,
    'answered', answered,
    'required', sess.questions_required,
    'complete', true
  );

  perform private.disable_trusted_review_write();
  return result;
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;

create or replace function public.submit_verification_answer(
  p_session_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  uid uuid := (select auth.uid());
  sess public.review_verification_sessions%rowtype;
  answer text := btrim(coalesce(p_answer, ''));
  next_seq integer;
  answered integer;
  agent_count integer;
  result jsonb;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into sess
  from public.review_verification_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session not found' using errcode = 'P0001';
  end if;
  if sess.user_id <> uid and not public.is_admin() then
    raise exception 'not your session' using errcode = '42501';
  end if;

  perform private.enable_trusted_review_write();

  if sess.expires_at <= now() or sess.status = 'expired' then
    update public.review_verification_sessions
    set status = 'expired', updated_at = now()
    where id = sess.id;
    update public.reviews
    set moderation_status = 'expired', updated_at = now()
    where id = sess.review_id
      and moderation_status in ('verification_pending', 'verification_in_progress');
    raise exception 'verification session expired' using errcode = 'P0001';
  end if;
  if sess.status not in ('pending', 'in_progress') then
    raise exception 'session is not active' using errcode = 'P0001';
  end if;

  if not public.verification_answer_is_substantive(answer) then
    raise exception 'answer must be substantive (5–1500 characters)'
      using errcode = 'P0001';
  end if;

  select count(*)::integer into answered
  from public.review_verification_messages m
  where m.session_id = sess.id and m.role = 'user';

  if answered >= sess.questions_required then
    raise exception 'all questions already answered' using errcode = 'P0001';
  end if;

  -- Cannot skip: must have an unanswered agent question for this index.
  select count(*)::integer into agent_count
  from public.review_verification_messages m
  where m.session_id = sess.id and m.role = 'agent';

  if answered >= agent_count then
    raise exception 'no pending question' using errcode = 'P0001';
  end if;

  -- sequence_number assigned server-side only (not client-supplied).
  select coalesce(max(sequence_number), 0) + 1 into next_seq
  from public.review_verification_messages
  where session_id = sess.id;

  insert into public.review_verification_messages (
    session_id, role, body, question_type, sequence_number
  ) values (
    sess.id, 'user', answer, 'answer', next_seq
  );

  answered := answered + 1;

  update public.review_verification_sessions
  set
    status = 'in_progress',
    current_question_index = answered,
    updated_at = now()
  where id = sess.id;

  result := jsonb_build_object(
    'answered', answered,
    'required', sess.questions_required,
    'complete', answered >= sess.questions_required
  );

  -- complete_verification_session manages its own trusted token lifecycle.
  perform private.disable_trusted_review_write();

  if answered >= sess.questions_required then
    result := public.complete_verification_session(p_session_id);
  end if;

  return result;
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;

-- Soft-delete own review
create or replace function public.hide_own_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.enable_trusted_review_write();

  update public.reviews r
  set moderation_status = 'hidden',
      updated_at = now()
  where r.id = p_review_id
    and r.user_id = (select auth.uid())
    and r.moderation_status is distinct from 'hidden';

  if not found then
    raise exception 'review not found or not owned' using errcode = 'P0001';
  end if;

  perform private.disable_trusted_review_write();
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;

-- Admin moderation
create or replace function public.admin_set_review_moderation(
  p_review_id uuid,
  p_moderation_status review_moderation_status,
  p_verification_level review_verification_level default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  lvl review_verification_level;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  perform private.enable_trusted_review_write();

  lvl := p_verification_level;

  if p_moderation_status = 'published' and lvl is null then
    lvl := 'ai_verified';
  end if;

  update public.reviews r
  set
    moderation_status = p_moderation_status,
    verification_level = coalesce(lvl, r.verification_level),
    published_at = case
      when p_moderation_status = 'published' then coalesce(r.published_at, now())
      else r.published_at
    end,
    verification_completed_at = case
      when p_moderation_status = 'published' then coalesce(r.verification_completed_at, now())
      else r.verification_completed_at
    end,
    transaction_verified_at = case
      when coalesce(lvl, r.verification_level) = 'transaction_verified'
        then coalesce(r.transaction_verified_at, now())
      else r.transaction_verified_at
    end,
    updated_at = now()
  where r.id = p_review_id;

  if not found then
    raise exception 'review not found' using errcode = 'P0001';
  end if;

  perform private.disable_trusted_review_write();
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;

create or replace function public.admin_set_report_status(
  p_report_id uuid,
  p_status review_report_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  update public.review_reports rr
  set status = p_status
  where rr.id = p_report_id;

  if not found then
    raise exception 'report not found' using errcode = 'P0001';
  end if;
end;
$$;

-- Expire stale sessions (admin or service cron only)
create or replace function public.expire_stale_verifications()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  perform private.enable_trusted_review_write();

  update public.review_verification_sessions s
  set status = 'expired', updated_at = now()
  where s.status in ('pending', 'in_progress')
    and s.expires_at <= now();

  get diagnostics n = row_count;

  update public.reviews r
  set moderation_status = 'expired', updated_at = now()
  from public.review_verification_sessions s
  where s.review_id = r.id
    and s.status = 'expired'
    and r.moderation_status in ('verification_pending', 'verification_in_progress');

  update public.review_verification_reminders rem
  set status = 'cancelled'
  from public.review_verification_sessions s
  where rem.session_id = s.id
    and s.status = 'expired'
    and rem.status = 'pending';

  perform private.disable_trusted_review_write();
  return n;
exception
  when others then
    perform private.disable_trusted_review_write();
    raise;
end;
$$;

-- Privileges: revoke broad EXECUTE, then grant only intended RPCs.
revoke all on function public.create_verification_session(uuid) from public;
revoke all on function public.submit_verification_answer(uuid, text) from public;
revoke all on function public.complete_verification_session(uuid) from public;
revoke all on function public.hide_own_review(uuid) from public;
revoke all on function public.admin_set_review_moderation(uuid, review_moderation_status, review_verification_level) from public;
revoke all on function public.admin_set_report_status(uuid, review_report_status) from public;
revoke all on function public.expire_stale_verifications() from public;
revoke all on function public.refresh_business_rating(uuid) from public;
revoke all on function public.verification_answer_is_substantive(text) from public;
revoke all on function public.verification_looks_contradictory(text, text[]) from public;
-- Pure weight helper is safe to expose (no auth side effects).
revoke all on function public.review_level_weight(review_verification_level) from public;
grant execute on function public.review_level_weight(review_verification_level) to authenticated;

grant execute on function public.create_verification_session(uuid) to authenticated;
grant execute on function public.submit_verification_answer(uuid, text) to authenticated;
grant execute on function public.complete_verification_session(uuid) to authenticated;
grant execute on function public.hide_own_review(uuid) to authenticated;
grant execute on function public.admin_set_review_moderation(uuid, review_moderation_status, review_verification_level) to authenticated;
grant execute on function public.admin_set_report_status(uuid, review_report_status) to authenticated;
grant execute on function public.expire_stale_verifications() to authenticated;
-- refresh_business_rating: trigger-only (no client EXECUTE)

-- ============ RLS ============
alter table public.reviews enable row level security;
alter table public.review_replies enable row level security;
alter table public.review_reports enable row level security;
alter table public.review_verification_sessions enable row level security;
alter table public.review_verification_messages enable row level security;
alter table public.review_verification_reminders enable row level security;

-- Table grants (column-level for reviews)
revoke all on table public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant insert (business_id, rating, body) on public.reviews to authenticated;
grant update (rating, body) on public.reviews to authenticated;
-- no DELETE; soft-hide via RPC

revoke all on table public.review_replies from anon, authenticated;
grant select on public.review_replies to anon, authenticated;
grant insert (review_id, body) on public.review_replies to authenticated;
grant update (body) on public.review_replies to authenticated;

revoke all on table public.review_reports from anon, authenticated;
grant select on public.review_reports to authenticated;
grant insert (review_id, reason, details) on public.review_reports to authenticated;

-- Verification tables: SELECT only — all writes via SECURITY DEFINER RPCs
revoke all on table public.review_verification_sessions from anon, authenticated;
revoke all on table public.review_verification_messages from anon, authenticated;
revoke all on table public.review_verification_reminders from anon, authenticated;
grant select on public.review_verification_sessions to authenticated;
grant select on public.review_verification_messages to authenticated;
grant select on public.review_verification_reminders to authenticated;

-- reviews SELECT
create policy "published reviews are publicly readable"
  on public.reviews for select to anon, authenticated
  using (moderation_status = 'published');

create policy "users can read own reviews"
  on public.reviews for select to authenticated
  using (user_id = (select auth.uid()));

create policy "admins can read all reviews"
  on public.reviews for select to authenticated
  using (public.is_admin());

-- Owners see published reviews for their business (not private drafts / AI dialog).
create policy "owners can read published reviews for own businesses"
  on public.reviews for select to authenticated
  using (
    moderation_status = 'published'
    and public.owns_business(business_id)
  );

create policy "users can create reviews"
  on public.reviews for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or user_id is null
  );

create policy "users can update own reviews"
  on public.reviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "admins can update reviews"
  on public.reviews for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- review_replies
create policy "replies of published reviews are public"
  on public.review_replies for select to anon, authenticated
  using (
    exists (
      select 1 from public.reviews r
      where r.id = review_id and r.moderation_status = 'published'
    )
  );

create policy "owners can read replies for own businesses"
  on public.review_replies for select to authenticated
  using (public.owns_business(business_id));

create policy "admins can read all replies"
  on public.review_replies for select to authenticated
  using (public.is_admin());

create policy "owners can insert replies"
  on public.review_replies for insert to authenticated
  with check (public.owns_business(business_id) or public.is_admin());

create policy "owners can update own replies"
  on public.review_replies for update to authenticated
  using (
    author_user_id = (select auth.uid())
    and public.owns_business(business_id)
  )
  with check (
    author_user_id = (select auth.uid())
    and public.owns_business(business_id)
  );

create policy "admins can update replies"
  on public.review_replies for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- review_reports
create policy "users can read own reports"
  on public.review_reports for select to authenticated
  using (reporter_user_id = (select auth.uid()) or public.is_admin());

create policy "users can create reports"
  on public.review_reports for insert to authenticated
  with check (reporter_user_id = (select auth.uid()) or reporter_user_id is null);

create policy "admins can update reports"
  on public.review_reports for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- verification sessions
create policy "users read own verification sessions"
  on public.review_verification_sessions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- verification messages
create policy "users read own verification messages"
  on public.review_verification_messages for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.review_verification_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- reminders: owner of session or admin (for future UX / admin)
create policy "users read own verification reminders"
  on public.review_verification_reminders for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.review_verification_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- Trigger functions must not be callable via PostgREST.
revoke all on function public.reviews_enforce_row() from public, anon, authenticated;
revoke all on function public.reviews_log_write_event() from public, anon, authenticated;
revoke all on function public.reviews_rate_limit_before_write() from public, anon, authenticated;
revoke all on function public.reviews_refresh_rating_trigger() from public, anon, authenticated;
revoke all on function public.review_replies_enforce_row() from public, anon, authenticated;
revoke all on function public.review_reports_enforce_row() from public, anon, authenticated;
revoke all on function public.review_reports_log_event() from public, anon, authenticated;
revoke all on function public.review_verification_messages_enforce() from public, anon, authenticated;
revoke all on function public.verification_answer_is_substantive(text) from public, anon, authenticated;
revoke all on function public.verification_looks_contradictory(text, text[]) from public, anon, authenticated;

-- businesses.rating_avg / reviews_count / ai_* / transaction_* remain
-- non-updatable by clients (re-assert column grants without aggregates).
revoke update on public.businesses from anon, authenticated;
grant update (
  name,
  short_description,
  description,
  phone,
  website,
  image_url,
  address_line,
  city,
  region,
  latitude,
  longitude,
  category_id
) on public.businesses to authenticated;
