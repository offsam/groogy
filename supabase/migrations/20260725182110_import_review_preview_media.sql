-- Preview images for import-review queue cards (Telegram post photos).
alter table public.import_review_items
  add column if not exists preview_image_url text;

comment on column public.import_review_items.preview_image_url is
  'Public URL of primary preview image (usually Telegram post photo) for admin queue.';

-- Allow public read of import-review previews in business-images bucket.
drop policy if exists "import review media public read" on storage.objects;
create policy "import review media public read"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'business-images'
    and (storage.foldername(name))[1] = 'import-review'
  );
