-- Admin: contact reveal leaderboard (businesses ranked by opens).

create or replace function public.admin_list_contact_reveal_businesses(
  p_q text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  business_id text,
  business_slug text,
  business_name text,
  reveals integer,
  total_count bigint,
  total_reveals bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_total_count bigint := 0;
  v_total_reveals bigint := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select count(*)::bigint
  into v_total_reveals
  from public.platform_events e
  where e.event_type = 'contact_reveal';

  return query
  with ranked as (
    select
      e.meta->>'business_id' as bid,
      coalesce(
        nullif(max(e.meta->>'business_slug'), ''),
        max(b.slug),
        'unknown'
      ) as bslug,
      coalesce(
        max(b.name),
        nullif(max(e.meta->>'business_slug'), ''),
        'Без названия'
      ) as bname,
      count(*)::integer as creveals
    from public.platform_events e
    left join public.businesses b
      on b.id::text = e.meta->>'business_id'
    where e.event_type = 'contact_reveal'
      and nullif(e.meta->>'business_id', '') is not null
    group by e.meta->>'business_id'
  ),
  filtered as (
    select r.*
    from ranked r
    where v_q is null
      or r.bname ilike '%' || v_q || '%'
      or r.bslug ilike '%' || v_q || '%'
  ),
  counted as (
    select count(*)::bigint as cnt from filtered
  )
  select
    f.bid,
    f.bslug,
    f.bname,
    f.creveals,
    c.cnt,
    v_total_reveals
  from filtered f
  cross join counted c
  order by f.creveals desc, f.bname asc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_list_contact_reveal_businesses(text, integer, integer)
  from public, anon;
grant execute on function public.admin_list_contact_reveal_businesses(text, integer, integer)
  to authenticated;

-- Total contact opens on platform analytics payload.
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
    'contact_reveals_total', (
      select count(*)::int from public.platform_events
      where event_type = 'contact_reveal'
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
