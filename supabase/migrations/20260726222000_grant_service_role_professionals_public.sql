-- Home counters / hub stats use service_role against professionals_public.
grant select on public.professionals to service_role;
grant select on public.professionals_public to service_role;

notify pgrst, 'reload schema';
