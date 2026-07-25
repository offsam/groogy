-- Expand business categories catalog for import / search / owner forms.
-- Idempotent: skip create when slug already exists under another name.

insert into public.categories (
  id, slug, name, name_en, icon, sort_order, is_active, domain
) values
  (
    'a1000001-0000-4000-8000-000000000009',
    'real_estate',
    'Недвижимость',
    'Real Estate',
    'real_estate',
    90,
    true,
    'business'
  ),
  (
    'a1000001-0000-4000-8000-00000000000a',
    'fitness',
    'Спорт и фитнес',
    'Sports & Fitness',
    'fitness',
    100,
    true,
    'business'
  ),
  (
    'a1000001-0000-4000-8000-00000000000b',
    'pets',
    'Животные',
    'Pets',
    'pets',
    110,
    true,
    'business'
  ),
  (
    'a1000001-0000-4000-8000-00000000000c',
    'finance',
    'Финансы и бухгалтерия',
    'Finance & Accounting',
    'finance',
    120,
    true,
    'business'
  ),
  (
    'a1000001-0000-4000-8000-00000000000d',
    'insurance',
    'Страхование',
    'Insurance',
    'insurance',
    130,
    true,
    'business'
  ),
  (
    'a1000001-0000-4000-8000-00000000000e',
    'travel',
    'Путешествия',
    'Travel',
    'travel',
    140,
    true,
    'business'
  ),
  (
    'a1000001-0000-4000-8000-00000000000f',
    'events',
    'Мероприятия',
    'Events',
    'events',
    150,
    true,
    'business'
  )
on conflict (slug) do update set
  name = excluded.name,
  name_en = excluded.name_en,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = true,
  domain = coalesce(public.categories.domain, excluded.domain);

-- Ensure grants remain intact for catalog consumers.
grant select on table public.categories to anon, authenticated, service_role;
