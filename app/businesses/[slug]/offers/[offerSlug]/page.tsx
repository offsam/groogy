import { redirect } from "next/navigation";

type LegacyOfferPageProps = {
  params: Promise<{ slug: string; offerSlug: string }>;
};

/** Spec alias: /businesses/... → /business/... */
export default async function LegacyBusinessOfferPage({
  params,
}: LegacyOfferPageProps) {
  const { slug, offerSlug } = await params;
  redirect(`/business/${slug}/offers/${offerSlug}`);
}
