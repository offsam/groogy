-- Contact reveal events + admin analytics for contact opens.

-- Allow contact_reveal event type
alter table public.platform_events
  drop constraint if exists platform_events_event_type_check;

alter table public.platform_events
  add constraint platform_events_event_type_check
  check (event_type in ('page_view', 'search', 'click', 'contact_reveal'));

create index if not exists platform_events_contact_reveal_created_idx
  on public.platform_events (created_at desc)
  where event_type = 'contact_reveal';

create index if not exists platform_events_contact_reveal_business_idx
  on public.platform_events ((meta->>'business_id'), created_at desc)
  where event_type = 'contact_reveal';

create or replace function public.get_admin_platform_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'users_total', (select count(*)::int from public.profiles),
    'users_today', (
      select count(*)::int from public.profiles
      where created_at >= date_trunc('day', now())
    ),
    'users_7d', (
      select count(*)::int from public.profiles
      where created_at >= now() - interval '7 days'
    ),
    'admins', (
      select count(*)::int from public.profiles where role = 'admin'
    ),
    'businesses_total', (select count(*)::int from public.businesses),
    'businesses_approved', (
      select count(*)::int from public.businesses where status = 'approved'
    ),
    'businesses_pending', (
      select count(*)::int from public.businesses where status = 'pending'
    ),
    'businesses_today', (
      select count(*)::int from public.businesses
      where created_at >= date_trunc('day', now())
    ),
    'listings_active', (
      select count(*)::int from public.listings where status = 'active'
    ),
    'listings_pending_reports', (
      select count(*)::int from public.listing_reports where status = 'pending'
    ),
    'offers_active', (
      select count(*)::int from public.business_offers
      where status = 'active' and visibility = 'public'
    ),
    'reviews_pending', (
      select count(*)::int from public.reviews
      where moderation_status in (
        'verification_pending',
        'verification_in_progress',
        'manual_review'
      )
    ),
    'page_views_today', (
      select count(*)::int from public.platform_events
      where event_type = 'page_view'
        and created_at >= date_trunc('day', now())
    ),
    'page_views_7d', (
      select count(*)::int from public.platform_events
      where event_type = 'page_view'
        and created_at >= now() - interval '7 days'
    ),
    'page_views_30d', (
      select count(*)::int from public.platform_events
      where event_type = 'page_view'
        and created_at >= now() - interval '30 days'
    ),
    'top_paths_7d', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select path, count(*)::int as views
        from public.platform_events
        where event_type = 'page_view'
          and created_at >= now() - interval '7 days'
        group by path
        order by views desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'contact_reveals_today', (
      select count(*)::int from public.platform_events
      where event_type = 'contact_reveal'
        and created_at >= date_trunc('day', now())
    ),
    'contact_reveals_7d', (
      select count(*)::int from public.platform_events
      where event_type = 'contact_reveal'
        and created_at >= now() - interval '7 days'
    ),
    'contact_reveals_30d', (
      select count(*)::int from public.platform_events
      where event_type = 'contact_reveal'
        and created_at >= now() - interval '30 days'
    ),
    'top_contact_reveals_7d', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          e.meta->>'business_id' as business_id,
          coalesce(
            nullif(e.meta->>'business_slug', ''),
            b.slug,
            'unknown'
          ) as business_slug,
          coalesce(b.name, e.meta->>'business_slug', 'Без названия') as business_name,
          e.meta->>'offer_id' as offer_id,
          e.meta->>'offer_slug' as offer_slug,
          count(*)::int as reveals
        from public.platform_events e
        left join public.businesses b
          on b.id::text = e.meta->>'business_id'
        where e.event_type = 'contact_reveal'
          and e.created_at >= now() - interval '7 days'
          and e.meta->>'business_id' is not null
        group by
          e.meta->>'business_id',
          e.meta->>'business_slug',
          e.meta->>'offer_id',
          e.meta->>'offer_slug',
          b.slug,
          b.name
        order by reveals desc
        limit 15
      ) t
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_platform_analytics() from public, anon;
grant execute on function public.get_admin_platform_analytics() to authenticated;
