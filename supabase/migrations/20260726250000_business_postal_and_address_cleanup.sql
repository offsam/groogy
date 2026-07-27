-- Structured address: ZIP as its own column; clean street lines that
-- duplicated state / ZIP / county (e.g. "… CA 92618, Orange County").

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS postal_code text;

COMMENT ON COLUMN public.businesses.postal_code IS
  'US ZIP (5 digits). Do not store ZIP inside address_line or region.';

COMMENT ON COLUMN public.businesses.address_line IS
  'Street / suite only — no city, state, ZIP, or county.';

COMMENT ON COLUMN public.businesses.region IS
  'County or metro label only (e.g. Orange County), not ZIP/state.';

-- Strip common trailing meta from address_line (repeat to peel stacked tails).
DO $$
DECLARE
  i int;
BEGIN
  FOR i IN 1..3 LOOP
    UPDATE public.businesses
    SET address_line = NULLIF(
      trim(both ' ,' FROM regexp_replace(
        address_line,
        '(?i)(,?\s*)(orange\s+county|los\s+angeles\s+county|san\s+diego\s+county|riverside\s+county|san\s+bernardino\s+county|\yOC\y|california|калифорния|,?\s*CA\s*\d{5}(-\d{4})?|,?\s*CA\y|,?\s*USA\y|\d{5}(-\d{4})?)\s*$',
        '',
        'g'
      )),
      ''
    )
    WHERE address_line IS NOT NULL
      AND address_line ~* '(orange\s+county|los\s+angeles\s+county|california|\yCA\y|\d{5}|\yOC\y|USA)';
  END LOOP;
END $$;

-- If region looks like a bare ZIP, move it to postal_code.
UPDATE public.businesses
SET
  postal_code = COALESCE(postal_code, substring(region FROM '(\d{5})')),
  region = NULL
WHERE region ~ '^\s*\d{5}(-\d{4})?\s*$'
  AND (postal_code IS NULL OR postal_code = '');

-- Extract ZIP from region dumps like "CA 92618" / "Orange County 92618".
UPDATE public.businesses
SET postal_code = COALESCE(
  postal_code,
  substring(region FROM '(\d{5})')
)
WHERE postal_code IS NULL
  AND region ~ '\d{5}';

-- Normalize region to county label when it still contains county words; drop ZIP from it.
UPDATE public.businesses
SET region = CASE
  WHEN region ~* 'orange\s+county|\yoc\y' THEN 'Orange County'
  WHEN region ~* 'los\s+angeles\s+county' THEN 'Los Angeles County'
  WHEN region ~* 'san\s+diego\s+county' THEN 'San Diego County'
  WHEN region ~* 'riverside\s+county' THEN 'Riverside County'
  WHEN region ~* 'san\s+bernardino\s+county' THEN 'San Bernardino County'
  WHEN region ~* '^\s*(CA|California|калифорния)\s*' THEN NULL
  ELSE region
END
WHERE region IS NOT NULL;

-- Default SoCal businesses without state_code.
UPDATE public.businesses
SET state_code = 'US-CA'
WHERE state_code IS NULL
  AND (
    region ILIKE '%County%'
    OR city ILIKE ANY (ARRAY[
      'Irvine','Anaheim','Santa Ana','Orange','Tustin','Costa Mesa',
      'Newport Beach','Huntington Beach','Mission Viejo','Laguna Niguel',
      'Laguna Hills','Lake Forest','Fullerton','Garden Grove','Buena Park',
      'Yorba Linda','Los Angeles','Long Beach','Pasadena','Glendale'
    ])
  );
