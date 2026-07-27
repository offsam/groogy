-- Allow service-role catalog cleanup / import to write professionals + events.
grant select, insert, update, delete on public.professionals to service_role;
grant select, insert, update, delete on public.events to service_role;

-- Children tables often needed when attaching media/services later.
do $$ begin
  if to_regclass('public.professional_services') is not null then
    execute 'grant select, insert, update, delete on public.professional_services to service_role';
  end if;
  if to_regclass('public.professional_media') is not null then
    execute 'grant select, insert, update, delete on public.professional_media to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
