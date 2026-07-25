-- Extend platform resource strip with more live site totals.

create or replace function public.get_platform_resource_stats()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with bounds as (
    select
      (
        date_trunc(
          'day',
          timezone('America/Los_Angeles', now())
        ) - interval '1 day'
      ) at time zone 'America/Los_Angeles' as yesterday_start,
      (
        date_trunc(
          'day',
          timezone('America/Los_Angeles', now())
        )
      ) at time zone 'America/Los_Angeles' as today_start
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
  public_services as (
    select
      id,
      coalesce(published_at, updated_at) as created_at,
      updated_at
    from public.services_catalog
    where lower(coalesce(state, 'draft')) in ('published', 'active', 'live')
  ),
  public_transfers as (
    select
      id,
      coalesce(published_at, updated_at) as created_at,
      updated_at
    from public.transfers_catalog
    where lower(coalesce(state, 'draft')) in ('published', 'active', 'live', 'open')
  ),
  public_lechu as (
    select
      id,
      coalesce(published_at, updated_at) as created_at,
      updated_at
    from public.lechu_catalog
    where lower(coalesce(state, 'draft')) in ('published', 'active', 'live', 'open')
  ),
  public_reviews as (
    select id, created_at, updated_at
    from public.reviews
    where moderation_status = 'published'
  ),
  public_categories as (
    select id
    from public.categories
  ),
  public_members as (
    select id, created_at
    from public.profiles
  ),
  all_resources as (
    select created_at, updated_at from public_businesses
    union all
    select created_at, updated_at from public_listings
    union all
    select created_at, updated_at from public_offers
    union all
    select created_at, updated_at from public_services
    union all
    select created_at, updated_at from public_transfers
    union all
    select created_at, updated_at from public_lechu
    union all
    select created_at, updated_at from public_reviews
  )
  select jsonb_build_object(
    'total', (select count(*)::int from all_resources),
    'businesses', (select count(*)::int from public_businesses),
    'listings', (select count(*)::int from public_listings),
    'offers', (select count(*)::int from public_offers),
    'services', (select count(*)::int from public_services),
    'transfers', (select count(*)::int from public_transfers),
    'lechu', (select count(*)::int from public_lechu),
    'reviews', (select count(*)::int from public_reviews),
    'categories', (select count(*)::int from public_categories),
    'members', (select count(*)::int from public_members),
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
    'members_today', (
      select count(*)::int
      from public_members, bounds
      where created_at >= bounds.today_start
    ),
    'as_of', to_jsonb(now())
  );
$$;

revoke all on function public.get_platform_resource_stats() from public;
grant execute on function public.get_platform_resource_stats() to anon, authenticated;
