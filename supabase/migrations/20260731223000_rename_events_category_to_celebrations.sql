-- Rename business/pro sphere «Мероприятия» → «Организация праздников».
-- Must not be confused with the dated affiche table public.events (/events).

update public.categories
set
  slug = 'celebrations',
  name = 'Организация праздников',
  name_en = 'Party planning',
  icon = 'celebrations',
  is_active = true
where slug = 'events'
  and domain = 'business';

notify pgrst, 'reload schema';
