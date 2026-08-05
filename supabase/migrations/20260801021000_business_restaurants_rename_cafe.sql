-- Business category label: Рестораны → Рестораны кафе

update public.categories
set name = 'Рестораны кафе'
where slug = 'restaurants';

notify pgrst, 'reload schema';
