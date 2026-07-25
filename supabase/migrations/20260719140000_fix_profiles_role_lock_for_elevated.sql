-- Hotfix: allow elevated sessions (no auth.uid) to update profiles.role
-- Client sessions still cannot change role / id / created_at.
-- Fixes admin seed in RLS suite and operational admin promotion via SQL.

create or replace function public.profiles_enforce_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.username := public.profiles_normalize_username(new.username);
    if new.display_name is not null then
      new.display_name := nullif(btrim(new.display_name), '');
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- End-user sessions cannot change identity/system fields.
    -- Elevated SQL (auth.uid() is null) may update role for ops/seeding.
    if (select auth.uid()) is not null then
      new.id := old.id;
      new.role := old.role;
      new.created_at := old.created_at;
    else
      new.id := old.id;
      new.created_at := old.created_at;
    end if;

    new.username := public.profiles_normalize_username(new.username);

    if new.display_name is not null then
      new.display_name := btrim(new.display_name);
      if new.display_name = '' then
        new.display_name := null;
      end if;
    end if;

    if new.bio is not null then
      new.bio := btrim(new.bio);
      if new.bio = '' then
        new.bio := null;
      end if;
    end if;

    if new.city is not null then
      new.city := btrim(new.city);
      if new.city = '' then
        new.city := null;
      end if;
    end if;

    if new.state is not null then
      new.state := btrim(new.state);
      if new.state = '' then
        new.state := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_enforce_row() from public, anon, authenticated;
