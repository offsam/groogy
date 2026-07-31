-- Admin who approved/imported a listing is not the owner.
-- Release owner_id on imported listings still hanging on admin/moderator accounts.
-- Source stays on the row (source_url / source_kind) — claim later assigns a real owner.

alter table public.listings disable trigger listings_enforce_row;

update public.listings l
set owner_id = null
from public.profiles p
where l.owner_id = p.id
  and p.role in ('admin', 'moderator')
  and (
    l.source_kind in ('telegram', 'facebook', 'directory')
    or (
      l.source_url is not null
      and btrim(l.source_url) <> ''
      and coalesce(l.source_kind, '') is distinct from 'platform'
    )
  );

alter table public.listings enable trigger listings_enforce_row;

comment on column public.listings.owner_id is
  'Real account owner after claim/create. NULL = imported/unowned until claimed. Admin approve must not set this.';
