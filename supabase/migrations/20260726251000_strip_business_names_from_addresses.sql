-- Address field = street only: strip business/venue names from address_line.

-- Exact name dumps
UPDATE public.businesses
SET address_line = NULL
WHERE address_line IS NOT NULL
  AND lower(btrim(address_line)) = lower(btrim(name));

-- Parenthetical studio/venue notes: "123 Main St (Wonderland Salon)"
UPDATE public.businesses
SET address_line = NULLIF(
  trim(both ' ,' FROM regexp_replace(address_line, '\([^)]*\)', '', 'g')),
  ''
)
WHERE address_line ~ '\(';

-- Non-streets: no house number and no street suffix (salon/venue/city lists)
UPDATE public.businesses
SET address_line = NULL
WHERE address_line IS NOT NULL
  AND btrim(address_line) <> ''
  AND address_line !~ '^\s*\d'
  AND address_line !~* '\y(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|cir|circle|pl|place|pkwy|parkway|hwy|highway|calle|camino)\y';

COMMENT ON COLUMN public.businesses.address_line IS
  'Street / suite only — no business name, city, state, ZIP, or county.';
