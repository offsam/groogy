-- Professional activity spheres (separate from business "Мастера / быт" dump).
-- Shared slugs (beauty, fitness, …) stay as business rows; pros may FK them.
-- New pro-only leaves use domain = professional.

alter table public.categories
  drop constraint if exists categories_domain_chk;

alter table public.categories
  add constraint categories_domain_chk check (
    domain in ('business', 'marketplace', 'services', 'professional')
  );

insert into public.categories (
  id, slug, name, name_en, icon, sort_order, is_active, domain
) values
  (
    'b1000001-0000-4000-8000-000000000001',
    'massage_wellness',
    'Массаж и wellness',
    'Massage & wellness',
    'massage_wellness',
    210,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000002',
    'health',
    'Здоровье и психика',
    'Health & mental care',
    'health',
    220,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000003',
    'childcare',
    'Дети и няни',
    'Childcare',
    'childcare',
    230,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000004',
    'photo_video',
    'Фото и видео',
    'Photo & video',
    'photo_video',
    240,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000005',
    'home_services',
    'Дом и ремонт',
    'Home services',
    'home_services',
    250,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000006',
    'home_food',
    'Готовим',
    'Home cooking',
    'home_food',
    260,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000007',
    'creative',
    'Дизайн и handmade',
    'Design & handmade',
    'creative',
    270,
    true,
    'professional'
  ),
  (
    'b1000001-0000-4000-8000-000000000008',
    'pro_other',
    'Прочее',
    'Other',
    'pro_other',
    290,
    true,
    'professional'
  )
on conflict (slug) do update set
  name = excluded.name,
  name_en = excluded.name_en,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = true,
  domain = 'professional';

grant select on table public.categories to anon, authenticated, service_role;

notify pgrst, 'reload schema';
