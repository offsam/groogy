-- Stop inventing California / Orange County when specialist autopublish omits location.
create or replace function public.service_autopublish_specialist_service(
  p_owner_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_short_description text default null,
  p_phone text default null,
  p_website text default null,
  p_instagram_url text default null,
  p_email text default null,
  p_city text default null,
  p_state text default null,
  p_business_category_id uuid default null,
  p_service_category_id uuid default null,
  p_service_area text default null,
  p_published_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_listing_id uuid;
  v_svc_cat uuid;
  v_title text := btrim(coalesce(p_name, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_slug text := btrim(coalesce(p_slug, ''));
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_state_raw text := nullif(btrim(coalesce(p_state, '')), '');
  v_state_code text := null;
  v_listing_state text := null;
begin
  if p_owner_id is null then
    raise exception 'owner_id required' using errcode = 'P0001';
  end if;
  if char_length(v_title) < 2 then
    raise exception 'name required' using errcode = 'P0001';
  end if;
  if char_length(v_desc) < 20 then
    raise exception 'description required' using errcode = 'P0001';
  end if;
  if char_length(v_slug) < 2 then
    raise exception 'slug required' using errcode = 'P0001';
  end if;

  if v_state_raw is not null then
    if upper(v_state_raw) in ('CA', 'US-CA', 'CALIFORNIA') then
      v_state_code := 'US-CA';
      v_listing_state := 'CA';
    elsif v_state_raw ~ '^US-[A-Za-z]{2}$' then
      v_state_code := upper(v_state_raw);
      v_listing_state := upper(substring(v_state_raw from 4 for 2));
    elsif v_state_raw ~ '^[A-Za-z]{2}$' then
      v_state_code := 'US-' || upper(v_state_raw);
      v_listing_state := upper(v_state_raw);
    else
      v_listing_state := v_state_raw;
    end if;
  end if;

  select id into v_svc_cat
  from public.listing_categories
  where id = p_service_category_id
    and listing_type = 'service'
    and is_active = true;

  if v_svc_cat is null then
    select id into v_svc_cat
    from public.listing_categories
    where listing_type = 'service'
      and is_active = true
      and slug = 'other-services'
    limit 1;
  end if;

  if v_svc_cat is null then
    select id into v_svc_cat
    from public.listing_categories
    where listing_type = 'service'
      and is_active = true
    order by sort_order
    limit 1;
  end if;

  insert into public.businesses (
    name,
    slug,
    short_description,
    description,
    phone,
    website,
    instagram_url,
    email,
    city,
    region,
    state_code,
    status,
    category_id
  ) values (
    v_title,
    v_slug,
    nullif(btrim(coalesce(p_short_description, '')), ''),
    v_desc,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_instagram_url, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    v_city,
    v_listing_state,
    v_state_code,
    'approved',
    p_business_category_id
  )
  returning id into v_business_id;

  perform private.enable_trusted_listing_write();
  begin
    insert into public.listings (
      owner_id,
      listing_type,
      status,
      visibility,
      title,
      description,
      city,
      state,
      contact_preference,
      publisher_type,
      publisher_business_id,
      published_at
    ) values (
      p_owner_id,
      'service',
      'active',
      'public',
      v_title,
      v_desc,
      v_city,
      v_listing_state,
      case when nullif(btrim(coalesce(p_phone, '')), '') is not null then 'phone' else 'any' end
        ::listing_contact_preference,
      'business',
      v_business_id,
      coalesce(p_published_at, now())
    )
    returning id into v_listing_id;

    insert into public.service_listing_details (
      listing_id,
      service_category_id,
      pricing_type,
      service_modes,
      service_area,
      languages
    ) values (
      v_listing_id,
      v_svc_cat,
      'contact_for_price',
      array['in_person', 'mobile']::text[],
      nullif(btrim(coalesce(p_service_area, coalesce(p_city, ''))), ''),
      array['ru']::text[]
    );

    perform private.disable_trusted_listing_write();
  exception when others then
    perform private.disable_trusted_listing_write();
    raise;
  end;

  return jsonb_build_object(
    'business_id', v_business_id,
    'listing_id', v_listing_id
  );
end;
$$;

revoke all on function public.service_autopublish_specialist_service(
  uuid, text, text, text, text, text, text, text, text, text, text, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.service_autopublish_specialist_service(
  uuid, text, text, text, text, text, text, text, text, text, text, uuid, uuid, text, timestamptz
) to service_role;
