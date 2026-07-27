-- After anti-scrape revoked anon SELECT on businesses, RLS helper
-- business_offer_is_public() failed with 42501 when it probed businesses.
-- Run as definer so public active offers stay readable without exposing contacts.

create or replace function public.business_offer_is_public(p_offer public.business_offers)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p_offer.status = 'active'
    and p_offer.visibility = 'public'
    and p_offer.is_available
    and exists (
      select 1 from public.businesses b
      where b.id = p_offer.business_id
        and b.status = 'approved'
    );
$$;

revoke all on function public.business_offer_is_public(public.business_offers) from public;
grant execute on function public.business_offer_is_public(public.business_offers) to anon, authenticated, service_role;
