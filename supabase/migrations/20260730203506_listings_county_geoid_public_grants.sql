-- USA Location Canon added listings.county_geoid (and jobs/events) but only
-- granted businesses / business_locations. Hub-scoped catalog hydration
-- selects listings.county_geoid for lechu / transfers / marketplace — without
-- this grant PostgREST returns 42501 and the page shows «каталог недоступен».

grant select (county_geoid) on public.listings to anon, authenticated;

-- Same gap for public job/event hub filters that select county_geoid.
grant select (county_geoid) on public.jobs to anon, authenticated;
grant select (county_geoid) on public.events to anon, authenticated;
