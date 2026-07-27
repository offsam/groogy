-- One-shot: move misclassified professionals → lechu / transfers, then archive pros.
-- Safe to re-run: skips if professional already archived or listing with same source_url exists.

do $$
declare
  v_owner uuid;
  v_cat_lechu_ru_us uuid;
  v_cat_lechu_other uuid;
  v_cat_transfer_us_ru uuid;
  r record;
  v_listing_id uuid;
  v_title text;
  v_desc text;
  v_kind text;
  v_cat uuid;
  v_existing uuid;
begin
  select id into v_owner from public.profiles where role = 'admin' limit 1;
  if v_owner is null then
    raise exception 'no admin profile';
  end if;

  select id into v_cat_lechu_ru_us from public.listing_categories where slug = 'lechu-ru-us' and is_active limit 1;
  select id into v_cat_lechu_other from public.listing_categories where slug = 'lechu-other' and is_active limit 1;
  select id into v_cat_transfer_us_ru from public.listing_categories where slug = 'transfer-us-ru' and is_active limit 1;

  for r in
    select *
    from public.professionals p
    where p.slug in (
      'fb-post-37-kristina-immerman-moscow-to-usa-courier',
      'jane-oc',
      'lana-205640-2183',
      'irinka-milovskaia'
    )
  loop
    if r.status = 'archived' then
      continue;
    end if;

    -- classify
    if r.slug in ('fb-post-37-kristina-immerman-moscow-to-usa-courier', 'jane-oc') then
      v_kind := 'lechu';
    else
      v_kind := 'transfer';
    end if;

    v_title := case r.slug
      when 'fb-post-37-kristina-immerman-moscow-to-usa-courier'
        then 'Лечу из Москвы в США — посылки, документы, лекарства'
      when 'jane-oc'
        then 'Таня летит — могу взять посылку'
      when 'lana-205640-2183'
        then 'Оплата покупок и услуг рублями (Zelle / ЦБ)'
      when 'irinka-milovskaia'
        then 'Обмен рублей на доллары (Zelle)'
    end;

    v_desc := nullif(btrim(coalesce(r.description, '')), '');
    if v_desc is null then
      v_desc := nullif(btrim(coalesce(r.short_description, '')), '');
    end if;
    if v_desc is null then
      v_desc := nullif(btrim(coalesce(r.headline, '')), '');
    end if;
    if v_desc is null then
      v_desc := coalesce(r.display_name, 'Объявление') || '. Свяжитесь по контактам.';
    end if;

    -- append contacts
    v_desc := v_desc
      || case when r.phone is not null then E'\n\nТелефон: ' || r.phone else '' end
      || case when r.telegram_url is not null then E'\nTelegram: ' || r.telegram_url else '' end
      || case when r.instagram_url is not null then E'\nInstagram: ' || r.instagram_url else '' end;

    -- dedupe by source_url + type
    if r.source_url is not null then
      select l.id into v_existing
      from public.listings l
      where l.source_url = r.source_url
        and l.listing_type = case when v_kind = 'lechu' then 'transport_carry'::public.listing_type else 'transfer'::public.listing_type end
        and l.status = 'active'
      limit 1;
      if v_existing is not null then
        update public.professionals set status = 'archived', updated_at = now() where id = r.id;
        continue;
      end if;
    end if;

    perform private.enable_trusted_listing_write();
    begin
      if v_kind = 'lechu' then
        v_cat := case
          when r.slug = 'fb-post-37-kristina-immerman-moscow-to-usa-courier' then v_cat_lechu_ru_us
          else v_cat_lechu_other
        end;

        insert into public.listings (
          owner_id, listing_type, status, visibility, author_visibility,
          title, description, price_currency, is_negotiable,
          city, state_code, publisher_type, source_kind, source_url, published_at
        ) values (
          v_owner,
          'transport_carry',
          'active',
          'public',
          'public',
          left(v_title, 120),
          left(v_desc, 8000),
          'USD',
          true,
          r.city,
          r.state_code,
          'profile',
          case
            when lower(coalesce(r.source_type, '')) like '%facebook%' then 'facebook'
            when lower(coalesce(r.source_type, '')) like '%telegram%' then 'telegram'
            when coalesce(r.source_url, '') like '%facebook.com%' then 'facebook'
            when coalesce(r.source_url, '') like '%t.me%' then 'telegram'
            else 'platform'
          end,
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
          case when r.slug = 'fb-post-37-kristina-immerman-moscow-to-usa-courier' then 'RU' else 'US' end,
          case when r.slug = 'fb-post-37-kristina-immerman-moscow-to-usa-courier' then 'US' else 'Other' end,
          case when r.slug = 'fb-post-37-kristina-immerman-moscow-to-usa-courier'
            then array['parcels','documents','medicine']::text[]
            else array['parcels','documents']::text[]
          end,
          'negotiable'
        );
      else
        v_cat := v_cat_transfer_us_ru;

        insert into public.listings (
          owner_id, listing_type, status, visibility, author_visibility,
          title, description, price_currency, is_negotiable,
          city, state_code, publisher_type, source_kind, source_url, published_at
        ) values (
          v_owner,
          'transfer',
          'active',
          'public',
          'public',
          left(v_title, 120),
          left(v_desc, 8000),
          'USD',
          true,
          r.city,
          r.state_code,
          'profile',
          case
            when lower(coalesce(r.source_type, '')) like '%telegram%' then 'telegram'
            when coalesce(r.source_url, '') like '%t.me%' then 'telegram'
            else 'platform'
          end,
          r.source_url,
          now()
        )
        returning id into v_listing_id;

        insert into public.transfer_listing_details (
          listing_id, category_id, from_country, to_country, transfer_method
        ) values (
          v_listing_id,
          v_cat,
          'US',
          'RU',
          case when r.slug = 'irinka-milovskaia' then 'cash' else 'other' end
        );
      end if;

      update public.professionals
      set status = 'archived', updated_at = now()
      where id = r.id;

      if r.source_record_id is not null
         and r.source_record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        update public.import_review_items
        set
          entity_type = case when v_kind = 'lechu' then 'lechu_listing'::public.import_review_entity_type else 'transfer_listing'::public.import_review_entity_type end,
          target_collection = case when v_kind = 'lechu' then 'lechu'::public.import_review_target_collection else 'transfers'::public.import_review_target_collection end,
          published_entity_type = 'listing',
          published_entity_id = v_listing_id,
          review_status = 'approved',
          updated_at = now()
        where id = r.source_record_id::uuid;
      end if;

      perform private.disable_trusted_listing_write();
    exception when others then
      perform private.disable_trusted_listing_write();
      raise;
    end;
  end loop;
end $$;
