-- Hotfix: allow anon to EXECUTE is_admin() used inside RLS expressions.
-- is_admin() is SECURITY DEFINER and returns false when auth.uid() is null.
-- Without this grant, anon SELECT on policies/views that reference is_admin()
-- fails with "permission denied for function is_admin" instead of evaluating false.

grant execute on function public.is_admin() to anon;

-- Same pattern for storage helper used by anon SELECT policy
-- (already granted readable; ensure owned stays authenticated-only)
grant execute on function public.listing_storage_object_readable(text) to anon, authenticated;
