-- Admin platform control: user roles, analytics overview, page-view events.

-- ---------------------------------------------------------------------------
-- Page / activity events (lightweight analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_events (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('page_view', 'search', 'click')),
  path       text not null default '/',
  referrer   text,
  user_id    uuid references auth.users(id) on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_events_created_at_idx
  on public.platform_events (created_at desc);
create index if not exists platform_events_type_created_idx
  on public.platform_events (event_type, created_at desc);

alter table public.platform_events enable row level security;

drop policy if exists "anyone can insert platform events" on public.platform_events;
create policy "anyone can insert platform events"
  on public.platform_events for insert
  to anon, authenticated
  with check (true);

drop policy if exists "admins can read platform events" on public.platform_events;
create policy "admins can read platform events"
  on public.platform_events for select
  to authenticated
  using (public.is_admin());

grant insert on public.platform_events to anon, authenticated;
grant select on public.platform_events to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: set user role (cannot demote self; cannot demote last admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role user_role
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
  v_admin_count int;
begin
  if v_caller is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_role not in ('user', 'business_owner', 'moderator', 'admin') then
    raise exception 'invalid role' using errcode = 'P0001';
  end if;

  if p_user_id = v_caller and p_role is distinct from 'admin' then
    raise exception 'cannot demote yourself' using errcode = 'P0001';
  end if;

  if p_role is distinct from 'admin' then
    select count(*) into v_admin_count
    from public.profiles
    where role = 'admin' and id <> p_user_id;
    if v_admin_count < 1 then
      -- if target is currently the only admin, block demotion
      if exists (
        select 1 from public.profiles
        where id = p_user_id and role = 'admin'
      ) then
        raise exception 'cannot remove the last admin' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Bypass profiles_enforce_row role lock: this function runs as security definer
  -- but the trigger checks auth.uid(). Temporarily the update still sees caller uid.
  -- Use a helper that sets role via a flag, or disable trigger for this statement.
  -- Approach: update using a session setting the trigger respects.
  perform set_config('app.allow_role_change', '1', true);

  update public.profiles
  set role = p_role, updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'user not found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, user_role) from public, anon;
grant execute on function public.admin_set_user_role(uuid, user_role) to authenticated;

-- Allow role change when app.allow_role_change=1 (set by admin_set_user_role)
create or replace function public.profiles_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.username := public.profiles_normalize_username(new.username);
    if new.display_name is not null then
      new.display_name := nullif(btrim(new.display_name), '');
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (select auth.uid()) is not null then
      new.id := old.id;
      new.created_at := old.created_at;
      -- Role lock unless admin RPC set app.allow_role_change=1
      if coalesce(current_setting('app.allow_role_change', true), '') <> '1' then
        new.role := old.role;
      end if;
    else
      new.id := old.id;
    end if;

    new.username := public.profiles_normalize_username(new.username);

    if new.display_name is not null then
      new.display_name := btrim(new.display_name);
      if new.display_name = '' then
        new.display_name := null;
      end if;
    end if;

    if new.bio is not null then
      new.bio := btrim(new.bio);
      if new.bio = '' then
        new.bio := null;
      end if;
    end if;

    if new.city is not null then
      new.city := btrim(new.city);
      if new.city = '' then
        new.city := null;
      end if;
    end if;

    if new.state is not null then
      new.state := btrim(new.state);
      if new.state = '' then
        new.state := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_enforce_row() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin analytics overview
-- ---------------------------------------------------------------------------
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
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_platform_analytics() from public, anon;
grant execute on function public.get_admin_platform_analytics() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: list users (profiles + email from auth via security definer)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  display_name text,
  role user_role,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.display_name,
    p.role,
    p.created_at,
    p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by
    case p.role when 'admin' then 0 when 'moderator' then 1 else 2 end,
    p.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: soft-delete business (archive) already exists; hard delete optional
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_business(
  p_business_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  -- Soft delete: archive (safe default)
  update public.businesses
  set status = 'archived', updated_at = now()
  where id = p_business_id;

  if not found then
    raise exception 'business not found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_delete_business(uuid) from public, anon;
grant execute on function public.admin_delete_business(uuid) to authenticated;

create or replace function public.admin_upsert_business(
  p_id uuid,
  p_name text,
  p_slug text,
  p_short_description text,
  p_description text,
  p_phone text,
  p_website text,
  p_city text,
  p_address_line text,
  p_status content_status,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name required' using errcode = 'P0001';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug required' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.businesses (
      name, slug, short_description, description, phone, website,
      city, address_line, status, category_id, state_code, created_at, updated_at
    ) values (
      btrim(p_name), btrim(p_slug), nullif(btrim(p_short_description), ''),
      nullif(btrim(p_description), ''), nullif(btrim(p_phone), ''),
      nullif(btrim(p_website), ''), nullif(btrim(p_city), ''),
      nullif(btrim(p_address_line), ''),
      coalesce(p_status, 'pending'), p_category_id, 'US-CA', now(), now()
    )
    returning id into v_id;
  else
    update public.businesses set
      name = btrim(p_name),
      slug = btrim(p_slug),
      short_description = nullif(btrim(p_short_description), ''),
      description = nullif(btrim(p_description), ''),
      phone = nullif(btrim(p_phone), ''),
      website = nullif(btrim(p_website), ''),
      city = nullif(btrim(p_city), ''),
      address_line = nullif(btrim(p_address_line), ''),
      status = coalesce(p_status, status),
      category_id = coalesce(p_category_id, category_id),
      updated_at = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'business not found' using errcode = 'P0001';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_business(
  uuid, text, text, text, text, text, text, text, text, content_status, uuid
) from public, anon;
grant execute on function public.admin_upsert_business(
  uuid, text, text, text, text, text, text, text, text, content_status, uuid
) to authenticated;
