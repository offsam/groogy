-- Fix: ambiguous PL/pgSQL variable "score" in complete_verification_session.
-- Also mark verification_looks_contradictory as STABLE (uses stable helpers).

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
