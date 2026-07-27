-- Publish open import_review lechu/transfers into listings, then mark approved.
-- Also picks up a couple of clear mis-typed transfer posts.
-- Re-run safe: skips when active listing already exists for source_url.

do $$
declare
  v_owner uuid;
  v_cat_lechu_us_ru uuid;
  v_cat_lechu_ru_us uuid;
  v_cat_lechu_other uuid;
  v_cat_transfer_us_ru uuid;
  r record;
  v_listing_id uuid;
  v_existing uuid;
  v_kind text;
  v_title text;
  v_desc text;
  v_cat uuid;
  v_dep text;
  v_dest text;
  v_blob text;
  v_source_kind text;
  v_phone text;
  v_tg text;
  n_lechu int := 0;
  n_transfer int := 0;
  n_linked int := 0;
  n_skip int := 0;
begin
  select id into v_owner from public.profiles where role = 'admin' limit 1;
  if v_owner is null then
    raise exception 'no admin profile';
  end if;

  select id into v_cat_lechu_us_ru from public.listing_categories where slug = 'lechu-us-ru' and is_active limit 1;
  select id into v_cat_lechu_ru_us from public.listing_categories where slug = 'lechu-ru-us' and is_active limit 1;
  select id into v_cat_lechu_other from public.listing_categories where slug = 'lechu-other' and is_active limit 1;
  select id into v_cat_transfer_us_ru from public.listing_categories where slug = 'transfer-us-ru' and is_active limit 1;

  for r in
    select *
    from public.import_review_items i
    where i.review_status in ('pending', 'in_review', 'needs_more_info', 'ready_to_publish')
      and (
        i.target_collection in ('lechu', 'transfers')
        or i.entity_type in ('lechu_listing', 'transfer_listing')
        -- clear mis-typed transfers
        or i.id in (
          '52e05db6-6202-4b91-a5bc-ba68e567c81d'::uuid, -- Обменяю рубли events
          '78be1a5d-1e50-43bc-a285-9b4d7db20385'::uuid  -- Яра marketplace
        )
      )
  loop
    v_kind := case
      when r.target_collection = 'lechu' or r.entity_type = 'lechu_listing' then 'lechu'
      when r.target_collection = 'transfers' or r.entity_type = 'transfer_listing' then 'transfer'
      when r.id in (
        '52e05db6-6202-4b91-a5bc-ba68e567c81d'::uuid,
        '78be1a5d-1e50-43bc-a285-9b4d7db20385'::uuid
      ) then 'transfer'
      else null
    end;
    if v_kind is null then
      n_skip := n_skip + 1;
      continue;
    end if;

    v_title := nullif(btrim(coalesce(r.title, r.person_name, r.business_name, '')), '');
    if v_title is null then
      v_title := case when v_kind = 'lechu' then 'Лечу — возьму посылку' else 'Обмен / перевод' end;
    end if;
    v_title := left(v_title, 120);

    v_desc := nullif(btrim(coalesce(r.description, '')), '');
    if v_desc is null then
      v_desc := nullif(btrim(coalesce(r.source_text, '')), '');
    end if;
    if v_desc is null then
      v_desc := v_title;
    end if;

    -- contacts footer
    v_phone := nullif(btrim(coalesce(r.phone[1], '')), '');
    v_tg := nullif(btrim(coalesce(r.telegram_username, '')), '');

    v_desc := v_desc
      || case when v_phone is not null then E'\n\nТелефон: ' || v_phone else '' end
      || case when v_tg is not null then E'\nTelegram: @' || ltrim(v_tg, '@') else '' end;
    v_desc := left(v_desc, 8000);

    v_blob := lower(coalesce(r.title,'') || ' ' || coalesce(r.description,'') || ' ' || coalesce(r.source_text,''));

    v_source_kind := case
      when lower(coalesce(r.source, '')) like '%facebook%' then 'facebook'
      when lower(coalesce(r.source, '')) like '%telegram%' then 'telegram'
      when coalesce(r.source_url, '') like '%facebook.com%' then 'facebook'
      when coalesce(r.source_url, '') like '%t.me%' then 'telegram'
      else 'platform'
    end;

    -- already published?
    v_existing := null;
    if r.source_url is not null then
      select l.id into v_existing
      from public.listings l
      where l.source_url = r.source_url
        and l.listing_type = case when v_kind = 'lechu' then 'transport_carry'::public.listing_type else 'transfer'::public.listing_type end
        and l.status = 'active'
      limit 1;
    end if;

    if v_existing is not null then
      update public.import_review_items
      set
        entity_type = case when v_kind = 'lechu' then 'lechu_listing'::public.import_review_entity_type else 'transfer_listing'::public.import_review_entity_type end,
        target_collection = case when v_kind = 'lechu' then 'lechu'::public.import_review_target_collection else 'transfers'::public.import_review_target_collection end,
        published_entity_type = 'listing',
        published_entity_id = v_existing,
        review_status = 'approved',
        updated_at = now()
      where id = r.id;
      n_linked := n_linked + 1;
      continue;
    end if;

    perform private.enable_trusted_listing_write();
    begin
      if v_kind = 'lechu' then
        -- route heuristics
        if v_blob ~ 'из\s+москв|из\s+рф|из\s+росси|москва\s*[→\->—–]+\s*(лос|ла|ирвайн|сша|usa)|влко|vko|svo|dme'
           and v_blob ~ 'лос|ла\b|ирвайн|california|сша|usa|оранж' then
          v_dep := 'RU'; v_dest := 'US'; v_cat := v_cat_lechu_ru_us;
        elsif v_blob ~ '(лос|ла\b|ирвайн|california|сша|usa).{0,40}(москв|росси|рф|спб|петербург|краснодар|владивосток)'
           or v_blob ~ 'лечу\s+в\s+москв|в\s+москву|→\s*москв' then
          v_dep := 'US'; v_dest := 'RU'; v_cat := v_cat_lechu_us_ru;
        elsif v_blob ~ 'варшав|стамбул|европ' then
          v_dep := 'US'; v_dest := 'Other'; v_cat := v_cat_lechu_other;
        else
          v_dep := 'US'; v_dest := 'RU'; v_cat := v_cat_lechu_us_ru;
        end if;

        insert into public.listings (
          owner_id, listing_type, status, visibility, author_visibility,
          title, description, price_currency, is_negotiable,
          city, state, publisher_type, source_kind, source_url, published_at
        ) values (
          v_owner,
          'transport_carry',
          'active',
          'public',
          'public',
          v_title,
          v_desc,
          'USD',
          true,
          nullif(btrim(coalesce(r.city, '')), ''),
          nullif(btrim(coalesce(r.state, '')), ''),
          'profile',
          v_source_kind,
          r.source_url,
          now()
        )
        returning id into v_listing_id;

        insert into public.lechu_listing_details (
          listing_id, category_id, departure_country, destination_country,
          carry_types, reward_type
        ) values (
          v_listing_id,
          v_cat,
          v_dep,
          v_dest,
          array['parcels','documents']::text[],
          'negotiable'
        );
        n_lechu := n_lechu + 1;
      else
        insert into public.listings (
          owner_id, listing_type, status, visibility, author_visibility,
          title, description, price_currency, is_negotiable,
          city, state, publisher_type, source_kind, source_url, published_at
        ) values (
          v_owner,
          'transfer',
          'active',
          'public',
          'public',
          v_title,
          v_desc,
          'USD',
          true,
          nullif(btrim(coalesce(r.city, '')), ''),
          nullif(btrim(coalesce(r.state, '')), ''),
          'profile',
          v_source_kind,
          r.source_url,
          now()
        )
        returning id into v_listing_id;

        insert into public.transfer_listing_details (
          listing_id, category_id, from_country, to_country, transfer_method
        ) values (
          v_listing_id,
          v_cat_transfer_us_ru,
          'US',
          'RU',
          case
            when v_blob ~ 'крипт|usdt|btc|crypto' then 'crypto'
            when v_blob ~ 'личн\w*\s+встреч|наличн|cash' then 'cash'
            when v_blob ~ 'zelle|карт|банк|перевод' then 'bank'
            else 'other'
          end
        );
        n_transfer := n_transfer + 1;
      end if;

      update public.import_review_items
      set
        entity_type = case when v_kind = 'lechu' then 'lechu_listing'::public.import_review_entity_type else 'transfer_listing'::public.import_review_entity_type end,
        target_collection = case when v_kind = 'lechu' then 'lechu'::public.import_review_target_collection else 'transfers'::public.import_review_target_collection end,
        published_entity_type = 'listing',
        published_entity_id = v_listing_id,
        review_status = 'approved',
        updated_at = now()
      where id = r.id;

      perform private.disable_trusted_listing_write();
    exception when others then
      perform private.disable_trusted_listing_write();
      raise;
    end;
  end loop;

  raise notice 'published lechu=%, transfers=%, linked_existing=%, skipped=%',
    n_lechu, n_transfer, n_linked, n_skip;
end $$;
