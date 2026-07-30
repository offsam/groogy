import type { Job, JobRow } from "@/types/job";
import { normalizeUsZip } from "@/lib/brand";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";

export function mapJob(row: JobRow): Job {
  const raw = row.businesses as
    | {
        id: string;
        slug: string;
        name: string;
        image_url: string | null;
        city: string | null;
        region: string | null;
        address_line: string | null;
        location_precision: "street" | "county" | null;
      }
    | {
        id: string;
        slug: string;
        name: string;
        image_url: string | null;
        city: string | null;
        region: string | null;
        address_line: string | null;
        location_precision: "street" | "county" | null;
      }[]
    | null
    | undefined;
  const biz = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: redactContactsFromPublicText(row.description),
    descriptionOriginal: redactContactsFromPublicText(
      row.description_original ?? null,
    ),
    city: row.city,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    status: row.status,
    paymentMethods: (row.payment_methods ?? []).filter(Boolean),
    businessId: row.business_id,
    businessSlug: biz?.slug ?? null,
    businessName: biz?.name ?? null,
    businessImageUrl: biz?.image_url ?? null,
    businessCity: biz?.city ?? null,
    businessRegion: biz?.region ?? null,
    businessAddressLine: biz?.address_line ?? null,
    businessLocationPrecision: biz?.location_precision ?? null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

/** Card click: business vacancy → business page; personal → full job listing. */
export function jobHref(job: Job): string {
  if (job.businessSlug) {
    return `/business/${job.businessSlug}?tab=jobs`;
  }
  return `/jobs/${job.slug}`;
}

function zipFromText(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? normalizeUsZip(match[1]) : null;
}

/**
 * Location line for job cards:
 * - business: company area / address (city, ZIP, or county)
 * - private: ZIP or county/city where they hire
 */
export function formatJobCardLocation(job: Job): string | null {
  if (job.businessId) {
    if (job.businessLocationPrecision === "county") {
      return (
        job.businessRegion?.trim() ||
        job.businessCity?.trim() ||
        job.city?.trim() ||
        null
      );
    }
    const zip =
      zipFromText(job.businessAddressLine) ||
      zipFromText(job.postalCode) ||
      null;
    const city = job.businessCity?.trim() || job.city?.trim() || null;
    const region = job.businessRegion?.trim() || null;
    const street =
      job.businessLocationPrecision === "street"
        ? job.businessAddressLine?.trim() || null
        : null;

    if (street && city) {
      return [street, city, zip].filter(Boolean).join(", ");
    }
    if (city && zip) return `${city}, ${zip}`;
    if (city && region) return `${city}, ${region}`;
    if (city) return city;
    if (zip) return zip;
    if (region) return region;
    return null;
  }

  // Private employer — ZIP or at least city/county
  const zip = zipFromText(job.postalCode) || zipFromText(job.city);
  const city = job.city?.trim() || null;
  const countyOrState = job.stateCode?.trim() || null;

  if (zip && city) return `${city}, ${zip}`;
  if (zip) return zip;
  if (city && countyOrState) return `${city}, ${countyOrState}`;
  if (city) return city;
  if (countyOrState) return countyOrState;
  return "По всей стране";
}

export function formatJobCardEmployer(job: Job): string {
  if (job.businessName?.trim()) return job.businessName.trim();
  return "Частный работодатель";
}

export function slugifyJobTitle(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = Date.now().toString(36).slice(-4);
  return `${base || "job"}-${stamp}`;
}
