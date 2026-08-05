-- Fill-empty on merge: email/socials/booking/contact_links/source_url/geo ZIP.
-- When both cards have different source_url, keep the keep URL and insert a
-- community_mention so Admin «Источники» still shows the donor provenance.
-- Also retarget import_review_items + recommendations before destroying donor.

create or replace function public.admin_merge_businesses(
  p_keep_id uuid,
  p_drop_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  keep_row public.businesses%rowtype;
  drop_row public.businesses%rowtype;
  offers_moved int := 0;
  owners_moved int := 0;
  claims_moved int := 0;
  reviews_moved int := 0;
  listings_moved int := 0;
  replies_moved int := 0;
  mentions_moved int := 0;
  conflict_slug text;
  v_summary jsonb;
  v_keep_links jsonb;
  v_drop_links jsonb;
  v_merged_links jsonb;
  v_secondary_source text;
  v_record_id text;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_keep_id = p_drop_id then
    raise exception 'keep and drop must differ' using errcode = 'P0001';
  end if;

  select * into keep_row from public.businesses where id = p_keep_id for update;
  if not found then
    raise exception 'keep business not found' using errcode = 'P0001';
  end if;
  select * into drop_row from public.businesses where id = p_drop_id for update;
  if not found then
    raise exception 'drop business not found' using errcode = 'P0001';
  end if;

  -- Provenance: point queue / recs at keep before donor id disappears.
  update public.import_review_items
  set
    published_entity_type = 'business',
    published_entity_id = p_keep_id,
    updated_at = now()
  where published_entity_id = p_drop_id
    and published_entity_type = 'business';

  update public.import_review_items
  set
    duplicate_of_entity_type = 'business',
    duplicate_of_entity_id = p_keep_id,
    updated_at = now()
  where duplicate_of_entity_id = p_drop_id
    and duplicate_of_entity_type = 'business';

  update public.import_comment_recommendations
  set
    published_entity_type = 'business',
    published_entity_id = p_keep_id,
    updated_at = now()
  where published_entity_id = p_drop_id
    and published_entity_type = 'business';

  update public.import_comment_recommendations
  set
    duplicate_of_entity_type = 'business',
    duplicate_of_entity_id = p_keep_id,
    updated_at = now()
  where duplicate_of_entity_id = p_drop_id
    and duplicate_of_entity_type = 'business';

  for conflict_slug in
    select o.slug
    from public.business_offers o
    where o.business_id = p_drop_id
      and exists (
        select 1 from public.business_offers k
        where k.business_id = p_keep_id and k.slug = o.slug
      )
  loop
    update public.business_offers
    set slug = left(conflict_slug || '-merged-' || substr(replace(p_drop_id::text, '-', ''), 1, 8), 80)
    where business_id = p_drop_id and slug = conflict_slug;
  end loop;

  update public.business_offers
  set business_id = p_keep_id, updated_at = now()
  where business_id = p_drop_id;
  get diagnostics offers_moved = row_count;

  insert into public.business_owners (business_id, user_id, role, created_at)
  select p_keep_id, bo.user_id, bo.role, bo.created_at
  from public.business_owners bo
  where bo.business_id = p_drop_id
    and not exists (
      select 1 from public.business_owners k
      where k.business_id = p_keep_id and k.user_id = bo.user_id
    );
  get diagnostics owners_moved = row_count;
  delete from public.business_owners where business_id = p_drop_id;

  delete from public.business_claims dc
  where dc.business_id = p_drop_id
    and dc.status = 'pending'
    and exists (
      select 1 from public.business_claims kc
      where kc.business_id = p_keep_id
        and kc.user_id = dc.user_id
        and kc.status = 'pending'
    );

  update public.business_claims
  set business_id = p_keep_id
  where business_id = p_drop_id;
  get diagnostics claims_moved = row_count;

  update public.reviews r
  set business_id = p_keep_id
  where r.business_id = p_drop_id
    and not exists (
      select 1 from public.reviews k
      where k.business_id = p_keep_id and k.user_id = r.user_id
    );
  get diagnostics reviews_moved = row_count;

  delete from public.reviews where business_id = p_drop_id;

  update public.review_replies
  set business_id = p_keep_id
  where business_id = p_drop_id;
  get diagnostics replies_moved = row_count;

  update public.listings
  set publisher_business_id = p_keep_id, updated_at = now()
  where publisher_business_id = p_drop_id;
  get diagnostics listings_moved = row_count;

  delete from public.business_community_mentions dm
  where dm.business_id = p_drop_id
    and dm.source_record_id is not null
    and exists (
      select 1 from public.business_community_mentions km
      where km.business_id = p_keep_id
        and km.source_record_id = dm.source_record_id
    );

  update public.business_community_mentions
  set business_id = p_keep_id
  where business_id = p_drop_id;
  get diagnostics mentions_moved = row_count;

  -- Union contact_links (TikTok etc.): keep rows + donor-only channels/values.
  v_keep_links := coalesce(keep_row.contact_links, '[]'::jsonb);
  v_drop_links := coalesce(drop_row.contact_links, '[]'::jsonb);
  if jsonb_typeof(v_keep_links) <> 'array' then
    v_keep_links := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_drop_links) <> 'array' then
    v_drop_links := '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
  into v_merged_links
  from (
    select elem, min(ord) as ord
    from (
      select value as elem, ordinality as ord
      from jsonb_array_elements(v_keep_links) with ordinality
      union all
      select d.value, 1000 + d.ordinality
      from jsonb_array_elements(v_drop_links) with ordinality as d
      where not exists (
        select 1
        from jsonb_array_elements(v_keep_links) k
        where lower(coalesce(k ->> 'channel', '')) = lower(coalesce(d.value ->> 'channel', ''))
          and lower(coalesce(k ->> 'value', '')) = lower(coalesce(d.value ->> 'value', ''))
      )
    ) u
    group by elem
  ) g;

  v_secondary_source := null;
  if nullif(btrim(coalesce(keep_row.source_url, '')), '') is not null
     and nullif(btrim(coalesce(drop_row.source_url, '')), '') is not null
     and lower(rtrim(btrim(keep_row.source_url), '/'))
         is distinct from lower(rtrim(btrim(drop_row.source_url), '/'))
  then
    v_secondary_source := btrim(drop_row.source_url);
  end if;

  update public.businesses k
  set
    phone = coalesce(nullif(btrim(k.phone), ''), drop_row.phone),
    email = coalesce(nullif(btrim(k.email), ''), drop_row.email),
    website = coalesce(nullif(btrim(k.website), ''), drop_row.website),
    instagram_url = coalesce(nullif(btrim(k.instagram_url), ''), drop_row.instagram_url),
    telegram_url = coalesce(nullif(btrim(k.telegram_url), ''), drop_row.telegram_url),
    google_maps_url = coalesce(nullif(btrim(k.google_maps_url), ''), drop_row.google_maps_url),
    booking_url = coalesce(nullif(btrim(k.booking_url), ''), drop_row.booking_url),
    yelp_url = coalesce(nullif(btrim(k.yelp_url), ''), drop_row.yelp_url),
    city = coalesce(nullif(btrim(k.city), ''), drop_row.city),
    region = coalesce(nullif(btrim(k.region), ''), drop_row.region),
    state_code = coalesce(nullif(btrim(k.state_code), ''), drop_row.state_code),
    postal_code = coalesce(nullif(btrim(k.postal_code), ''), drop_row.postal_code),
    address_line = coalesce(nullif(btrim(k.address_line), ''), drop_row.address_line),
    latitude = coalesce(k.latitude, drop_row.latitude),
    longitude = coalesce(k.longitude, drop_row.longitude),
    image_url = coalesce(nullif(btrim(k.image_url), ''), drop_row.image_url),
    category_id = coalesce(k.category_id, drop_row.category_id),
    source_url = coalesce(nullif(btrim(k.source_url), ''), drop_row.source_url),
    source_kind = coalesce(nullif(btrim(k.source_kind), ''), drop_row.source_kind),
    contact_links = v_merged_links,
    short_description = case
      when nullif(btrim(k.short_description), '') is null then drop_row.short_description
      else k.short_description
    end,
    description = case
      when nullif(btrim(k.description), '') is null then drop_row.description
      else k.description
    end,
    third_party_mention_count =
      greatest(coalesce(k.third_party_mention_count, 0), 0)
      + greatest(coalesce(drop_row.third_party_mention_count, 0), 0),
    self_ad_mention_count =
      greatest(coalesce(k.self_ad_mention_count, 0), 0)
      + greatest(coalesce(drop_row.self_ad_mention_count, 0), 0),
    updated_at = now()
  where k.id = p_keep_id;

  if v_secondary_source is not null then
    v_record_id := 'merged-source:' || lower(rtrim(btrim(v_secondary_source), '/'));
    insert into public.business_community_mentions (
      business_id, kind, source_channel, source_label, source_url,
      source_record_id, snippet, author_label, status, published_at
    )
    select
      p_keep_id,
      'community_mention',
      'import',
      left(coalesce(nullif(btrim(drop_row.name), ''), 'источник при слиянии'), 120),
      v_secondary_source,
      v_record_id,
      left('Источник карточки при слиянии: ' || coalesce(drop_row.name, 'donor'), 500),
      'merge',
      'published',
      now()
    where not exists (
      select 1 from public.business_community_mentions m
      where m.business_id = p_keep_id
        and (
          m.source_record_id = v_record_id
          or m.source_url = v_secondary_source
        )
    );
  end if;

  delete from public.businesses where id = p_drop_id;

  v_summary := jsonb_build_object(
    'keep_id', p_keep_id,
    'drop_id', p_drop_id,
    'offers_moved', offers_moved,
    'owners_moved', owners_moved,
    'claims_moved', claims_moved,
    'reviews_moved', reviews_moved,
    'replies_moved', replies_moved,
    'listings_moved', listings_moved,
    'mentions_moved', mentions_moved,
    'donor_destroyed', true,
    'secondary_source_preserved', v_secondary_source is not null
  );

  perform public.emit_domain_event(
    'business.merged', 'business', p_keep_id, v_summary
  );

  return v_summary;
end;
$$;
