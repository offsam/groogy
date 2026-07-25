-- Presence badges on listing cards: Instagram + Google Maps / rating.
alter table public.businesses
  add column if not exists instagram_url text,
  add column if not exists google_maps_url text,
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_reviews_count integer not null default 0;

alter table public.businesses
  drop constraint if exists businesses_google_rating_chk;

alter table public.businesses
  add constraint businesses_google_rating_chk
  check (
    google_rating is null
    or (google_rating >= 0 and google_rating <= 5)
  );

alter table public.businesses
  drop constraint if exists businesses_google_reviews_count_chk;

alter table public.businesses
  add constraint businesses_google_reviews_count_chk
  check (google_reviews_count >= 0);

comment on column public.businesses.instagram_url is
  'Public Instagram profile URL for listing badges.';
comment on column public.businesses.google_maps_url is
  'Google Maps / Place URL when the business is listed on Maps.';
comment on column public.businesses.google_rating is
  'Google Maps rating (0–5), shown on listing cards with Google badge.';
comment on column public.businesses.google_reviews_count is
  'Number of Google reviews (optional display context).';

-- Backfill Instagram from website field when it already points at Instagram.
update public.businesses
set instagram_url = website
where instagram_url is null
  and website is not null
  and website ~* 'instagram\.com';

-- Extend admin upsert with presence fields (replace signature).
drop function if exists public.admin_upsert_business(
  uuid, text, text, text, text, text, text, text, text, content_status, uuid
);

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
  p_category_id uuid,
  p_instagram_url text default null,
  p_google_maps_url text default null,
  p_google_rating numeric default null,
  p_google_reviews_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_instagram text;
  v_maps text;
  v_rating numeric(2,1);
  v_gcount integer;
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

  v_instagram := nullif(btrim(coalesce(p_instagram_url, '')), '');
  v_maps := nullif(btrim(coalesce(p_google_maps_url, '')), '');
  v_rating := case
    when p_google_rating is null then null
    else round(p_google_rating::numeric, 1)
  end;
  v_gcount := greatest(coalesce(p_google_reviews_count, 0), 0);

  if p_id is null then
    insert into public.businesses (
      name, slug, short_description, description, phone, website,
      city, address_line, status, category_id, state_code,
      instagram_url, google_maps_url, google_rating, google_reviews_count,
      created_at, updated_at
    ) values (
      btrim(p_name), btrim(p_slug), nullif(btrim(p_short_description), ''),
      nullif(btrim(p_description), ''), nullif(btrim(p_phone), ''),
      nullif(btrim(p_website), ''), nullif(btrim(p_city), ''),
      nullif(btrim(p_address_line), ''), coalesce(p_status, 'pending'),
      p_category_id, null,
      v_instagram, v_maps, v_rating, v_gcount,
      now(), now()
    )
    returning id into v_id;
  else
    update public.businesses
    set
      name = btrim(p_name),
      slug = btrim(p_slug),
      short_description = nullif(btrim(p_short_description), ''),
      description = nullif(btrim(p_description), ''),
      phone = nullif(btrim(p_phone), ''),
      website = nullif(btrim(p_website), ''),
      city = nullif(btrim(p_city), ''),
      address_line = nullif(btrim(p_address_line), ''),
      status = coalesce(p_status, status),
      category_id = p_category_id,
      instagram_url = v_instagram,
      google_maps_url = v_maps,
      google_rating = v_rating,
      google_reviews_count = v_gcount,
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
  uuid, text, text, text, text, text, text, text, text, content_status, uuid,
  text, text, numeric, integer
) from public, anon;
grant execute on function public.admin_upsert_business(
  uuid, text, text, text, text, text, text, text, text, content_status, uuid,
  text, text, numeric, integer
) to authenticated;
