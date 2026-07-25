-- Rename business category "Услуги" → "Мастера / быт"
-- to avoid collision with platform section /services.

update public.categories
set
  name = 'Мастера / быт',
  name_en = coalesce(nullif(trim(name_en), ''), 'Home services')
where slug = 'services'
  and name = 'Услуги';
