-- Area-only location: city/county on profile + filters, no map pin without street.
-- Also backfill from import source_group when city/region were empty.

-- Move county labels out of city into region (professionals)
UPDATE public.professionals
SET
  region = CASE
    WHEN city ~* '^(oc|orange\s*county|оранж)' THEN 'Orange County'
    WHEN city ~* 'los\s*angeles\s*county' THEN 'Los Angeles County'
    WHEN city ~* 'san\s*diego\s*county' THEN 'San Diego County'
    ELSE city
  END,
  city = NULL,
  location_precision = COALESCE(location_precision, 'county'),
  latitude = NULL,
  longitude = NULL,
  public_exact_address = false
WHERE city ~* 'county|\moc\M|оранж\s*каунти';

-- Same for businesses
UPDATE public.businesses
SET
  region = CASE
    WHEN city ~* '^(oc|orange\s*county|оранж)' THEN 'Orange County'
    WHEN city ~* 'los\s*angeles\s*county' THEN 'Los Angeles County'
    WHEN city ~* 'san\s*diego\s*county' THEN 'San Diego County'
    ELSE city
  END,
  city = NULL,
  location_precision = 'county',
  latitude = CASE WHEN address_line IS NULL OR btrim(address_line) = '' THEN NULL ELSE latitude END,
  longitude = CASE WHEN address_line IS NULL OR btrim(address_line) = '' THEN NULL ELSE longitude END
WHERE city ~* 'county|\moc\M|оранж\s*каунти';

-- Backfill professionals from import group when no city/region
UPDATE public.professionals p
SET
  region = CASE
    WHEN i.source_group ~* 'orange|fun for mom|orangecounty'
      OR i.source ~* 'orange_county|fun_for_mom' THEN 'Orange County'
    WHEN i.source_group ~* 'sacramento|сакраменто'
      OR i.source ~* 'sacramento' THEN NULL
    WHEN i.source_group ~* 'los\s*angeles|\mla\M|glendale'
      OR i.source ~* 'los_angeles' THEN 'Los Angeles County'
    ELSE p.region
  END,
  city = CASE
    WHEN (p.city IS NULL OR btrim(p.city) = '')
      AND (i.source_group ~* 'sacramento|сакраменто' OR i.source ~* 'sacramento')
      THEN 'Sacramento'
    WHEN (p.city IS NULL OR btrim(p.city) = '')
      AND (i.source_group ~* 'los\s*angeles|\mla\M' OR i.source_url ~* 'Los\.Angeles|losangeles')
      AND i.source_group !~* 'orange'
      THEN 'Los Angeles'
    ELSE p.city
  END,
  state_code = COALESCE(p.state_code, 'US-CA'),
  location_precision = CASE
    WHEN p.private_address_line IS NOT NULL AND btrim(p.private_address_line) <> '' THEN p.location_precision
    WHEN i.source_group ~* 'orange|fun for mom' OR i.source ~* 'orange_county' THEN 'county'
    WHEN i.source_group ~* 'sacramento' OR i.source ~* 'sacramento' THEN 'city'
    ELSE COALESCE(p.location_precision, 'city')
  END,
  latitude = CASE
    WHEN p.private_address_line IS NULL OR btrim(p.private_address_line) = '' THEN NULL
    ELSE p.latitude
  END,
  longitude = CASE
    WHEN p.private_address_line IS NULL OR btrim(p.private_address_line) = '' THEN NULL
    ELSE p.longitude
  END
FROM public.import_review_items i
WHERE i.published_entity_id = p.id
  AND lower(coalesce(i.published_entity_type, '')) IN ('professional', 'private_specialist')
  AND (p.city IS NULL OR btrim(p.city) = '')
  AND (p.region IS NULL OR btrim(p.region) = '');

-- Backfill businesses from import group
UPDATE public.businesses b
SET
  region = CASE
    WHEN i.source_group ~* 'orange|fun for mom|orangecounty'
      OR i.source ~* 'orange_county|fun_for_mom' THEN COALESCE(NULLIF(btrim(b.region), ''), 'Orange County')
    WHEN i.source_group ~* 'los\s*angeles|\mla\M'
      OR i.source_url ~* 'Los\.Angeles' THEN COALESCE(NULLIF(btrim(b.region), ''), 'Los Angeles County')
    ELSE b.region
  END,
  city = CASE
    WHEN (b.city IS NULL OR btrim(b.city) = '')
      AND (i.source_group ~* 'sacramento' OR i.source_url ~* 'Sacramento')
      THEN 'Sacramento'
    WHEN (b.city IS NULL OR btrim(b.city) = '')
      AND (i.source_group ~* 'los\s*angeles|\mla\M' OR i.source_url ~* 'Los\.Angeles')
      AND i.source_group !~* 'orange'
      THEN 'Los Angeles'
    ELSE b.city
  END,
  state_code = COALESCE(b.state_code, 'US-CA'),
  location_precision = CASE
    WHEN b.address_line IS NOT NULL AND btrim(b.address_line) <> '' AND b.address_line ~ '^\s*\d'
      THEN COALESCE(b.location_precision, 'street')
    WHEN i.source_group ~* 'orange|fun for mom' OR i.source ~* 'orange_county'
      THEN 'county'
    ELSE b.location_precision
  END,
  latitude = CASE
    WHEN b.address_line IS NULL OR btrim(b.address_line) = '' OR b.address_line !~ '^\s*\d'
      THEN NULL
    ELSE b.latitude
  END,
  longitude = CASE
    WHEN b.address_line IS NULL OR btrim(b.address_line) = '' OR b.address_line !~ '^\s*\d'
      THEN NULL
    ELSE b.longitude
  END
FROM public.import_review_items i
WHERE i.published_entity_id = b.id
  AND lower(coalesce(i.published_entity_type, '')) IN ('business', 'organization', 'service')
  AND (b.city IS NULL OR btrim(b.city) = '')
  AND (b.region IS NULL OR btrim(b.region) = '' OR b.region !~* 'county');
