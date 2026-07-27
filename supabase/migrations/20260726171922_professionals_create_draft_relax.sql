-- Allow draft professional create with completed profile (name + ZIP).
-- Publishing to approved still gated in app via can_publish() (verified contact).

drop policy if exists "professionals owner insert" on public.professionals;
create policy "professionals owner insert"
  on public.professionals for insert
  to authenticated
  with check (
    (
      owner_profile_id = (select auth.uid())
      and created_by_profile_id = (select auth.uid())
      and (
        public.can_publish()
        or public.is_profile_completed((select auth.uid()))
      )
    )
    or public.is_admin()
  );
