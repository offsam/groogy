-- Public top search queries (AI search logs in platform_events.event_type = 'search').
-- Meta contract: { "q": "<raw query>" }

create index if not exists platform_events_search_q_idx
  on public.platform_events ((lower(trim(meta->>'q'))), created_at desc)
  where event_type = 'search'
    and coalesce(meta->>'q', '') <> '';

create or replace function public.get_popular_search_queries(
  p_limit integer default 50
)
returns table (
  query text,
  hits bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    lower(trim(e.meta->>'q')) as query,
    count(*)::bigint as hits
  from public.platform_events e
  where e.event_type = 'search'
    and char_length(trim(coalesce(e.meta->>'q', ''))) between 2 and 80
    and e.meta->>'q' !~* 'https?://'
    and e.meta->>'q' !~ '[0-9]{7,}'
  group by 1
  order by hits desc, query asc
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.get_popular_search_queries(integer) from public;
grant execute on function public.get_popular_search_queries(integer)
  to anon, authenticated;

comment on function public.get_popular_search_queries(integer) is
  'Top AI-search queries by frequency for the public search page.';
