-- Per-directory source for external Yellow Pages panels in admin.

alter table public.import_comment_recommendations
  add column if not exists directory_source text;

comment on column public.import_comment_recommendations.directory_source is
  'External directory key when target_bucket=yellow_pages: orange_pages | russian_seattle | svoi | …';

create index if not exists import_comment_recommendations_directory_source_idx
  on public.import_comment_recommendations (directory_source, status)
  where target_bucket = 'yellow_pages';

-- Backfill existing cards from cluster_key / source_groups.
update public.import_comment_recommendations
set directory_source = 'orange_pages'
where target_bucket = 'yellow_pages'
  and directory_source is null
  and (
    cluster_key like 'rop-%'
    or exists (
      select 1
      from unnest(coalesce(source_groups, '{}'::text[])) as g
      where g ilike '%orange pages%'
    )
  );

update public.import_comment_recommendations
set directory_source = 'russian_seattle'
where target_bucket = 'yellow_pages'
  and directory_source is null
  and (
    cluster_key like 'rasea-%'
    or exists (
      select 1
      from unnest(coalesce(source_groups, '{}'::text[])) as g
      where g ilike '%seattle%'
    )
  );
