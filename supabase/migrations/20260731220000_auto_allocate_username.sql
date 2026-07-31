-- Auto-allocate username from display name (or email local-part) on signup.
-- If taken → append digits. Backfill existing null usernames.

create or replace function public.profiles_slugify_username_base(p_raw text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  s text := lower(coalesce(p_raw, ''));
  out text := '';
  i int;
  ch text;
begin
  -- Basic Cyrillic → Latin (enough for RU display names)
  s := replace(s, 'ё', 'e');
  s := replace(s, 'ж', 'zh');
  s := replace(s, 'х', 'h');
  s := replace(s, 'ц', 'ts');
  s := replace(s, 'ч', 'ch');
  s := replace(s, 'ш', 'sh');
  s := replace(s, 'щ', 'sch');
  s := replace(s, 'ю', 'yu');
  s := replace(s, 'я', 'ya');
  s := translate(
    s,
    'абвгдезийклмнопрстуфъыьэ',
    'abvgdezijklmnoprstufyye'
  );

  for i in 1 .. char_length(s) loop
    ch := substr(s, i, 1);
    if ch ~ '[a-z0-9]' then
      out := out || ch;
    elsif ch ~ '[[:space:]_\-.\+]' then
      if out <> '' and right(out, 1) <> '_' then
        out := out || '_';
      end if;
    end if;
  end loop;

  out := trim(both '_' from out);
  out := regexp_replace(out, '_+', '_', 'g');

  if char_length(out) < 3 then
    return 'user';
  end if;

  if char_length(out) > 24 then
    out := left(out, 24);
    out := trim(both '_' from out);
  end if;

  if char_length(out) < 3 then
    return 'user';
  end if;

  return out;
end;
$$;

create or replace function public.profiles_allocate_username(p_base text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := public.profiles_slugify_username_base(p_base);

  -- Reserved words → force numeric suffix path
  begin
    perform public.profiles_normalize_username(base);
  exception
    when others then
      base := base || '_u';
      if char_length(base) > 24 then
        base := left(base, 24);
      end if;
  end;

  candidate := base;
  loop
    if not exists (
      select 1 from public.profiles p where p.username = candidate
    ) then
      return candidate;
    end if;
    n := n + 1;
    if n > 9999 then
      candidate := left(base, 20) || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
      if not exists (
        select 1 from public.profiles p where p.username = candidate
      ) then
        return candidate;
      end if;
      raise exception 'could not allocate username';
    end if;
    candidate := left(base, 30 - char_length(n::text)) || n::text;
  end loop;
end;
$$;

revoke all on function public.profiles_slugify_username_base(text) from public;
grant execute on function public.profiles_slugify_username_base(text) to authenticated, service_role;

revoke all on function public.profiles_allocate_username(text) from public;
grant execute on function public.profiles_allocate_username(text) to authenticated, service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_display text;
  v_avatar text;
  v_base text;
  v_username text;
begin
  v_display := nullif(
    btrim(
      coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      )
    ),
    ''
  );
  v_avatar := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  );

  v_base := coalesce(
    v_display,
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );
  v_username := public.profiles_allocate_username(v_base);

  insert into public.profiles (id, display_name, avatar_url, username)
  values (new.id, v_display, v_avatar, v_username)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Backfill existing profiles without username
do $$
declare
  r record;
  v_base text;
  v_username text;
begin
  for r in
    select p.id, p.display_name, u.email
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.username is null
  loop
    v_base := coalesce(
      nullif(btrim(r.display_name), ''),
      nullif(split_part(coalesce(r.email, ''), '@', 1), ''),
      'user'
    );
    v_username := public.profiles_allocate_username(v_base);
    update public.profiles
    set username = v_username
    where id = r.id and username is null;
  end loop;
end;
$$;
