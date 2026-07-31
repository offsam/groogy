-- Public member profile counters for VK-style card:
-- split marketplace vs services active counts + circles (entity_follows).

create or replace function public.get_public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  p public.profiles%rowtype;
  uid uuid := (select auth.uid());
  is_self boolean;
  reviews_published int;
  reviews_ai int;
  listings_active int;
  listings_completed int;
  services_active int;
  circles int;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if uname = '' then
    return null;
  end if;

  select * into p from public.profiles where username = uname;
  if not found then
    return null;
  end if;

  is_self := (uid is not null and uid = p.id);

  select
    count(*) filter (where r.moderation_status = 'published'),
    count(*) filter (
      where r.moderation_status = 'published'
        and r.verification_level in ('ai_verified', 'transaction_verified')
    )
  into reviews_published, reviews_ai
  from public.reviews r
  where r.user_id = p.id;

  select
    count(*) filter (
      where l.status = 'active'
        and l.visibility = 'public'
        and l.domain = 'marketplace'
    ),
    count(*) filter (where l.status = 'completed'),
    count(*) filter (
      where l.status = 'active'
        and l.visibility = 'public'
        and l.domain = 'services'
    )
  into listings_active, listings_completed, services_active
  from public.listings l
  where l.owner_id = p.id;

  select count(*)
  into circles
  from public.entity_follows f
  where f.user_id = p.id;

  if p.profile_visibility = 'private' and not is_self then
    return jsonb_build_object(
      'mode', 'private',
      'is_self', false,
      'label', 'Пользователь #' || public.stable_user_number(p.id)::text,
      'username', null,
      'display_name', null,
      'avatar_url', null,
      'bio', null,
      'city', null,
      'state', null,
      'member_since', p.created_at,
      'reviews_published_count', coalesce(reviews_published, 0),
      'reviews_ai_verified_count', coalesce(reviews_ai, 0),
      'listings_active_count', coalesce(listings_active, 0),
      'listings_completed_count', coalesce(listings_completed, 0),
      'services_active_count', coalesce(services_active, 0),
      'circles_count', coalesce(circles, 0),
      'show_reviews', false,
      'show_listings', false
    );
  end if;

  return jsonb_build_object(
    'mode', case when p.profile_visibility = 'public' then 'public' else 'private_preview' end,
    'is_self', is_self,
    'owner_id', case when is_self then p.id else null end,
    'label', coalesce(nullif(btrim(p.display_name), ''), p.username, 'Пользователь'),
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'city', p.city,
    'state', p.state,
    'member_since', p.created_at,
    'profile_visibility', p.profile_visibility,
    'reviews_published_count', coalesce(reviews_published, 0),
    'reviews_ai_verified_count', coalesce(reviews_ai, 0),
    'listings_active_count', coalesce(listings_active, 0),
    'listings_completed_count', coalesce(listings_completed, 0),
    'services_active_count', coalesce(services_active, 0),
    'circles_count', coalesce(circles, 0),
    'show_reviews', p.show_reviews_in_profile and p.public_activity_enabled and p.profile_visibility = 'public',
    'show_listings', p.show_listings_in_profile and p.public_activity_enabled and p.profile_visibility = 'public'
  );
end;
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

comment on function public.get_public_profile(text) is
  'Public member profile card: identity + reviews/listings/services/circles counters.';
