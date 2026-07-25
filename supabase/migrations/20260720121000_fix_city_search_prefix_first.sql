-- Hotfix: city search — use trigram only as fallback when prefix matches are empty.
-- Prevents unrelated fuzzy hits (e.g. 'Ghostville' → random similar names).

create or replace function public.search_platform_cities(
  p_query text,
  p_state_code text default null,
  p_limit integer default 20
)
returns table (
  geoid text,
  state_code text,
  name text,
  name_normalized text,
  slug text,
  latitude double precision,
  longitude double precision,
  population integer
)
language plpgsql
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  q text := public.normalize_place_name(p_query);
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 20);
  prefix_count integer;
begin
  if q is null or char_length(q) < 2 then
    return;
  end if;

  select count(*) into prefix_count
  from public.platform_cities c
  where c.is_active
    and (p_state_code is null or c.state_code = p_state_code)
    and (
      c.name_normalized like q || '%'
      or c.name_normalized like '% ' || q || '%'
    );

  if prefix_count > 0 then
    return query
    select
      c.geoid,
      c.state_code,
      c.name,
      c.name_normalized,
      c.slug,
      c.latitude,
      c.longitude,
      c.population
    from public.platform_cities c
    where c.is_active
      and (p_state_code is null or c.state_code = p_state_code)
      and (
        c.name_normalized like q || '%'
        or c.name_normalized like '% ' || q || '%'
      )
    order by
      case when c.name_normalized = q then 0
           when c.name_normalized like q || '%' then 1
           else 2 end,
      char_length(c.name_normalized),
      c.name_normalized
    limit lim;
    return;
  end if;

  -- Fallback fuzzy only when no prefix hits (min 3 chars to reduce noise)
  if char_length(q) < 3 then
    return;
  end if;

  return query
  select
    c.geoid,
    c.state_code,
    c.name,
    c.name_normalized,
    c.slug,
    c.latitude,
    c.longitude,
    c.population
  from public.platform_cities c
  where c.is_active
    and (p_state_code is null or c.state_code = p_state_code)
    and c.name_normalized % q
  order by
    similarity(c.name_normalized, q) desc,
    char_length(c.name_normalized),
    c.name_normalized
  limit lim;
end;
$$;

revoke all on function public.search_platform_cities(text, text, integer) from public;
grant execute on function public.search_platform_cities(text, text, integer) to anon, authenticated;
