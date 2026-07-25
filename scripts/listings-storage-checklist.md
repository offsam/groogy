# Listing images Storage — security checklist

Bucket: `listing-images` (**private**, `public = false`)  
Path: `listings/{auth.uid()}/{listing_id}/{filename}`  
App serves images via **signed URLs** (`createSignedUrl`, TTL ~1h).

## Automated / SQL-adjacent

- [ ] After migration: `select public from storage.buckets where id = 'listing-images';` → `false`
- [ ] MIME allow-list: jpeg/png/webp/gif only
- [ ] `file_size_limit` = 5242880
- [ ] `listing_media_enforce` rejects path not matching owner+listing_id
- [ ] `listing_media_enforce` rejects `..` in path
- [ ] RLS SQL suite items 18–21 pass (media ownership / private read / cap / sort_order)

## Manual (post `db push` — requires confirmation)

1. **Public listing image**
   - Publish listing with photo as user A
   - As anon: `createSignedUrl` for path succeeds; raw public URL `/object/public/...` returns 400/404
2. **Private listing image**
   - Set listing `visibility=private`
   - As user B / anon: signed URL create fails or download 403
   - As owner A: signed URL works
3. **Removed listing image**
   - Admin removes listing
   - As anon: signed URL / download denied
4. **Cross-user upload**
   - User B attempts upload to `listings/{A_uid}/{A_listing_id}/x.jpg` → denied
   - User A attempts upload to `listings/{A_uid}/{B_listing_id}/x.jpg` → denied (listing not owned)
5. **Pre-create listing folder**
   - Upload to random UUID listing_id under own uid without owning listing → denied
6. **Orphan cleanup**
   - Delete media via UI → DB row gone and storage object removed (`removeListingMediaAction`)
7. **App bundle**
   - `grep -R service_role lib app components` → empty

## Remaining residual risk

- Signed URLs remain valid until TTL expiry after listing becomes private/removed; keep TTL short (1h).
- Clients holding an old signed URL can fetch until expiry — acceptable trade-off without CDN purge.
