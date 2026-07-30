-- One person keeps one profile; every ad of theirs becomes another service in
-- it. Guard the invariant in the database so no import path or manual add can
-- create the same offer twice under one professional.

create unique index if not exists professional_services_unique_title_idx
  on public.professional_services (
    professional_id,
    lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))
  )
  where is_active;

comment on index public.professional_services_unique_title_idx is
  'No repeated offer titles inside one professional profile (active rows).';

notify pgrst, 'reload schema';
