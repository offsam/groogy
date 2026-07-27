-- PostgREST cannot call admin_list_import_review_items when text + enum
-- overloads both exist (PGRST203). Keep a single text-arg function.

drop function if exists public.admin_list_import_review_items(
  text, text, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, numeric, numeric, timestamptz, timestamptz, text, text, integer, integer
);

drop function if exists public.admin_list_import_review_items(
  public.import_review_status,
  public.import_review_target_collection,
  public.import_review_entity_type,
  text, text, boolean, boolean, boolean, boolean, boolean,
  text, numeric, numeric, timestamptz, timestamptz, text, text, integer, integer
);

create or replace function public.admin_list_import_review_items(
  p_review_status text default null,
  p_target_collection text default null,
  p_entity_type text default null,
  p_category text default null,
  p_city text default null,
  p_has_phone boolean default false,
  p_has_telegram boolean default false,
  p_has_instagram boolean default false,
  p_has_website boolean default false,
  p_has_media boolean default false,
  p_duplicate_status text default null,
  p_confidence_min numeric default null,
  p_confidence_max numeric default null,
  p_posted_from timestamptz default null,
  p_posted_to timestamptz default null,
  p_q text default null,
  p_sort text default 'priority',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  item jsonb,
  total_count bigint,
  contact_priority_score integer,
  completeness_score integer,
  contact_level text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      i.*,
      public.import_review_contact_priority_score(
        i.phone, i.whatsapp, i.telegram_username, i.email, i.website, i.instagram,
        i.source_url, i.telegram_user_id
      ) as cps
    from public.import_review_items i
    where
      (p_review_status is null or p_review_status = 'all' or i.review_status::text = p_review_status)
      and (p_target_collection is null or p_target_collection = 'all'
        or i.target_collection::text = p_target_collection)
      and (p_entity_type is null or p_entity_type = 'all'
        or i.entity_type::text = p_entity_type)
      and (p_category is null or p_category = '' or i.category = p_category)
      and (p_city is null or p_city = '' or i.city ilike '%' || p_city || '%')
      and (not coalesce(p_has_phone, false) or coalesce(cardinality(i.phone), 0) > 0)
      and (not coalesce(p_has_telegram, false)
        or nullif(btrim(coalesce(i.telegram_username, '')), '') is not null
        or nullif(btrim(coalesce(i.telegram_user_id, '')), '') is not null)
      and (not coalesce(p_has_instagram, false) or coalesce(cardinality(i.instagram), 0) > 0)
      and (not coalesce(p_has_website, false) or coalesce(cardinality(i.website), 0) > 0)
      and (not coalesce(p_has_media, false) or coalesce(i.photos_count, 0) > 0)
      and (p_duplicate_status is null or p_duplicate_status = ''
        or i.duplicate_status = p_duplicate_status)
      and (p_confidence_min is null or i.ai_confidence >= p_confidence_min)
      and (p_confidence_max is null or i.ai_confidence <= p_confidence_max)
      and (p_posted_from is null or i.source_posted_at >= p_posted_from)
      and (p_posted_to is null or i.source_posted_at <= p_posted_to)
      and (
        v_q is null
        or i.title ilike '%' || v_q || '%'
        or i.business_name ilike '%' || v_q || '%'
        or i.person_name ilike '%' || v_q || '%'
        or i.source_text ilike '%' || v_q || '%'
        or i.source ilike '%' || v_q || '%'
        or i.source_group ilike '%' || v_q || '%'
        or i.telegram_username ilike '%' || v_q || '%'
        or i.telegram_user_id = v_q
        or i.source_author_display_name ilike '%' || v_q || '%'
        or exists (
          select 1 from unnest(coalesce(i.phone, '{}'::text[])) ph
          where ph ilike '%' || v_q || '%'
        )
        or exists (
          select 1 from unnest(coalesce(i.instagram, '{}'::text[])) ig
          where ig ilike '%' || v_q || '%'
        )
        or exists (
          select 1 from unnest(coalesce(i.website, '{}'::text[])) w
          where w ilike '%' || v_q || '%'
        )
      )
  ),
  enriched as (
    select
      b.*,
      public.import_review_completeness_score(
        b.title, b.description, b.city, b.category, b.price, b.photos_count, b.cps
      ) as cms,
      case
        when (
          coalesce(cardinality(b.phone), 0) > 0
          or coalesce(cardinality(b.whatsapp), 0) > 0
          or nullif(btrim(coalesce(b.telegram_username, '')), '') is not null
          or coalesce(cardinality(b.email), 0) > 0
          or coalesce(cardinality(b.website), 0) > 0
          or coalesce(cardinality(b.instagram), 0) > 0
        ) and b.cps >= 180 then 'full'
        when (
          coalesce(cardinality(b.phone), 0) > 0
          or coalesce(cardinality(b.whatsapp), 0) > 0
          or nullif(btrim(coalesce(b.telegram_username, '')), '') is not null
          or coalesce(cardinality(b.email), 0) > 0
          or coalesce(cardinality(b.website), 0) > 0
          or coalesce(cardinality(b.instagram), 0) > 0
        ) then 'has_contact'
        when nullif(btrim(coalesce(b.source_url, '')), '') is not null
          or nullif(btrim(coalesce(b.telegram_user_id, '')), '') is not null
        then 'telegram_only'
        else 'none'
      end as clevel
    from base b
  ),
  counted as (
    select count(*)::bigint as total from enriched
  ),
  ordered as (
    select e.*
    from enriched e
    order by
      case
        when coalesce(p_sort, 'priority') = 'oldest' then extract(epoch from e.created_at)
        else null
      end asc nulls last,
      case
        when coalesce(p_sort, 'priority') = 'newest' then extract(epoch from e.created_at)
        when coalesce(p_sort, 'priority') = 'posted_at' then extract(epoch from e.source_posted_at)
        when coalesce(p_sort, 'priority') = 'updated' then extract(epoch from e.updated_at)
        when coalesce(p_sort, 'priority') = 'confidence_desc' then e.ai_confidence::double precision
        else null
      end desc nulls last,
      case
        when coalesce(p_sort, 'priority') = 'confidence_asc' then e.ai_confidence::double precision
        else null
      end asc nulls last,
      case
        when coalesce(p_sort, 'priority') in ('priority', '') or p_sort is null
          then e.cps
        else null
      end desc nulls last,
      case
        when coalesce(p_sort, 'priority') in ('priority', '') or p_sort is null
          then e.cms
        else null
      end desc nulls last,
      case
        when coalesce(p_sort, 'priority') in ('priority', '') or p_sort is null
          then e.ai_confidence::double precision
        else null
      end desc nulls last,
      e.source_posted_at desc nulls last,
      e.created_at desc
    limit v_limit
    offset v_offset
  )
  select
    to_jsonb(o) - 'cps' - 'cms' - 'clevel' - 'raw_payload' as item,
    (select total from counted) as total_count,
    o.cps as contact_priority_score,
    o.cms as completeness_score,
    o.clevel as contact_level
  from ordered o;
end;
$$;

revoke all on function public.admin_list_import_review_items(
  text, text, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, numeric, numeric, timestamptz, timestamptz, text, text, integer, integer
) from public, anon;

grant execute on function public.admin_list_import_review_items(
  text, text, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, numeric, numeric, timestamptz, timestamptz, text, text, integer, integer
) to authenticated, service_role;

notify pgrst, 'reload schema';
