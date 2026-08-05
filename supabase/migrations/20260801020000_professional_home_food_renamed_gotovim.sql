-- Professionals sphere: home_food is «Готовим», not business «Рестораны».
-- Move any pros still on business restaurants → home_food.

update public.categories
set
  name = 'Готовим',
  name_en = 'Home cooking',
  domain = 'professional',
  is_active = true
where slug = 'home_food';

update public.professionals p
set category_id = c_home.id
from public.categories c_rest
join public.categories c_home on c_home.slug = 'home_food'
where p.category_id = c_rest.id
  and c_rest.slug = 'restaurants';

notify pgrst, 'reload schema';
