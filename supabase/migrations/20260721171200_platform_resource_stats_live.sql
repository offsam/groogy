-- Near-live platform resource stats: today/yesterday adds + today's updates.

create or replace function public.get_platform_resource_stats()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with bounds as (
    select
      ((timezone('America/Los_Angeles', now())::date - 1)
        at time zone 'America/Los_Angeles') as yesterday_start,
      (timezone('America/Los_Angeles', now())::date
        at time zone 'America/Los_Angeles') as today_start
  ),
  public_businesses as (
    select id, created_at, updated_at
    from public.businesses
    where status = 'approved'
  ),
  public_listings as (
    select id, created_at, updated_at
    from public.listings
    where
      (
        status = 'active'
        and visibility in ('public', 'unlisted')
      )
      or (
        status = 'completed'
        and visibility = 'public'
      )
  ),
  public_offers as (
    select o.id, o.created_at, o.updated_at
    from public.business_offers o
    join public.businesses b on b.id = o.business_id
    where o.status = 'active'
      and o.visibility = 'public'
      and o.is_available
      and b.status = 'approved'
  ),
  all_resources as (
    select created_at, updated_at from public_businesses
    union all
    select created_at, updated_at from public_listings
    union all
    select created_at, updated_at from public_offers
  )
  select jsonb_build_object(
    'total', (select count(*)::int from all_resources),
    'businesses', (select count(*)::int from public_businesses),
    'listings', (select count(*)::int from public_listings),
    'offers', (select count(*)::int from public_offers),
    'added_yesterday', (
      select count(*)::int
      from all_resources, bounds
      where created_at >= bounds.yesterday_start
        and created_at < bounds.today_start
    ),
    'added_today', (
      select count(*)::int
      from all_resources, bounds
      where created_at >= bounds.today_start
    ),
    'updated_today', (
      select count(*)::int
      from all_resources, bounds
      where updated_at >= bounds.today_start
        and created_at < bounds.today_start
    ),
    'as_of', to_jsonb(now())
  );
$$;

revoke all on function public.get_platform_resource_stats() from public;
grant execute on function public.get_platform_resource_stats() to anon, authenticated;
