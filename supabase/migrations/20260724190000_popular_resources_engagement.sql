-- Popular home feed: rank entities by click opens in platform_events.
-- Meta contract for event_type = 'click':
--   { "entity_type": "business"|"marketplace"|"service"|"lechu"|"transfer",
--     "entity_id": "<uuid>" }

create index if not exists platform_events_click_entity_idx
  on public.platform_events (
    (meta->>'entity_type'),
    ((meta->>'entity_id')::uuid),
    created_at desc
  )
  where event_type = 'click'
    and meta ? 'entity_type'
    and meta ? 'entity_id'
    and (meta->>'entity_id') ~* '^[0-9a-f-]{36}$';

create or replace function public.popular_resource_scores(
  p_days integer default 14,
  p_limit integer default 48
)
returns table (
  entity_type text,
  entity_id uuid,
  score bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with bounds as (
    select greatest(1, least(coalesce(p_days, 14), 90)) as days,
           greatest(1, least(coalesce(p_limit, 48), 100)) as lim
  ),
  scored as (
    select
      e.meta->>'entity_type' as entity_type,
      (e.meta->>'entity_id')::uuid as entity_id,
      count(*)::bigint as score
    from public.platform_events e
    cross join bounds b
    where e.event_type = 'click'
      and e.created_at >= now() - make_interval(days => b.days)
      and e.meta ? 'entity_type'
      and e.meta ? 'entity_id'
      and (e.meta->>'entity_id') ~* '^[0-9a-f-]{36}$'
      and e.meta->>'entity_type' in (
        'business',
        'marketplace',
        'service',
        'lechu',
        'transfer'
      )
    group by 1, 2
  )
  select s.entity_type, s.entity_id, s.score
  from scored s
  cross join bounds b
  order by s.score desc, s.entity_id
  limit (select lim from bounds);
$$;

revoke all on function public.popular_resource_scores(integer, integer)
  from public, anon, authenticated;
grant execute on function public.popular_resource_scores(integer, integer)
  to anon, authenticated;

comment on function public.popular_resource_scores(integer, integer) is
  'Aggregated click opens for the home «Популярное» mix. SECURITY DEFINER returns only public entity ids + scores.';
