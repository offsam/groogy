-- Profile ZIP columns (20260723165000) shipped without grants.
-- Authenticated users could not UPDATE/SELECT postal_code; service_role only
-- had SELECT on profiles (20260725030510), so the app fallback also failed.

grant select (postal_code, county_geoid) on public.profiles to authenticated;
grant update (postal_code, county_geoid) on public.profiles to authenticated;

grant select, update on table public.profiles to service_role;

-- Owner-scoped ZIP writer (works even if column UPDATE grants lag).
create or replace function public.set_own_profile_postal(
  p_postal text,
  p_county_geoid text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := (select auth.uid());
  zip text;
  county text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  zip := nullif(regexp_replace(coalesce(p_postal, ''), '\D', '', 'g'), '');
  if zip is null or char_length(zip) < 5 then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  zip := left(zip, 5);

  county := nullif(btrim(coalesce(p_county_geoid, '')), '');
  if county is not null
     and not exists (
       select 1 from public.platform_counties c where c.geoid = county
     ) then
    county := null;
  end if;

  update public.profiles
  set
    postal_code = zip,
    county_geoid = coalesce(county, county_geoid)
  where id = uid;

  return found;
end;
$$;

revoke all on function public.set_own_profile_postal(text, text) from public;
grant execute on function public.set_own_profile_postal(text, text) to authenticated;
