-- Merging two live businesses used to leave recommendations behind: mention
-- rows stayed on the archived card and the counters were never added up, so a
-- business lost the «N рекомендаций» it had earned. Merge now carries the
-- mentions over (deduped by source_record_id) and sums both origin counters.

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

  -- Offers: rename slug on conflict, then re-parent.
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

  -- Owners: skip users already owning keep.
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

  -- Claims: re-parent; drop pending that would collide.
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

  -- Reviews: move only when keep has no review from same user.
  update public.reviews r
  set business_id = p_keep_id
  where r.business_id = p_drop_id
    and not exists (
      select 1 from public.reviews k
      where k.business_id = p_keep_id and k.user_id = r.user_id
    );
  get diagnostics reviews_moved = row_count;

  update public.review_replies
  set business_id = p_keep_id
  where business_id = p_drop_id;
  get diagnostics replies_moved = row_count;

  update public.listings
  set publisher_business_id = p_keep_id, updated_at = now()
  where publisher_business_id = p_drop_id;
  get diagnostics listings_moved = row_count;

  -- Community mentions: the same recommendation must not land twice, so rows
  -- whose source is already on keep are dropped instead of moved.
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

  -- Fill empty keep fields from drop; recommendation counters accumulate.
  update public.businesses k
  set
    phone = coalesce(nullif(btrim(k.phone), ''), drop_row.phone),
    website = coalesce(nullif(btrim(k.website), ''), drop_row.website),
    city = coalesce(nullif(btrim(k.city), ''), drop_row.city),
    region = coalesce(nullif(btrim(k.region), ''), drop_row.region),
    state_code = coalesce(nullif(btrim(k.state_code), ''), drop_row.state_code),
    address_line = coalesce(nullif(btrim(k.address_line), ''), drop_row.address_line),
    latitude = coalesce(k.latitude, drop_row.latitude),
    longitude = coalesce(k.longitude, drop_row.longitude),
    image_url = coalesce(nullif(btrim(k.image_url), ''), drop_row.image_url),
    category_id = coalesce(k.category_id, drop_row.category_id),
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

  update public.businesses
  set status = 'archived', updated_at = now()
  where id = p_drop_id;

  v_summary := jsonb_build_object(
    'keep_id', p_keep_id,
    'drop_id', p_drop_id,
    'offers_moved', offers_moved,
    'owners_moved', owners_moved,
    'claims_moved', claims_moved,
    'reviews_moved', reviews_moved,
    'replies_moved', replies_moved,
    'listings_moved', listings_moved,
    'mentions_moved', mentions_moved
  );

  perform public.emit_domain_event(
    'business.merged', 'business', p_keep_id, v_summary
  );

  return v_summary;
end;
$$;
