import type { ListingType } from "@/types/listing";
import type {
  ClaimProofInput,
  ClaimStateResult,
  ClaimSubmitResult,
} from "@/lib/claims/actions";

export type ListingClaimKind =
  | "marketplace"
  | "services"
  | "transfers"
  | "lechu";

export function listingKindFromType(listingType: ListingType): ListingClaimKind {
  if (listingType === "service") return "services";
  if (listingType === "transfer") return "transfers";
  if (listingType === "transport_carry" || listingType === "vehicle") {
    return "lechu";
  }
  return "marketplace";
}

export function listingPublicPath(kind: ListingClaimKind, id: string) {
  return `/${kind}/${id}`;
}

export function listingEditPath(kind: ListingClaimKind, id: string) {
  return `/${kind}/${id}/edit`;
}

export function listingClaimIdleLabel(kind: ListingClaimKind) {
  if (kind === "services") return "Это моя услуга";
  return "Это моё объявление";
}

export function buildClaimVerificationDetails(proof: ClaimProofInput): string {
  const lines: string[] = [];
  const phone = proof.phone.trim();
  if (phone) lines.push(`phone: ${phone}`);
  const website = proof.website?.trim();
  if (website) lines.push(`website: ${website}`);
  const ig = proof.instagramUrl?.trim();
  if (ig) lines.push(`instagram: ${ig}`);
  const fb = proof.facebookUrl?.trim();
  if (fb) lines.push(`facebook: ${fb}`);
  const yelp = proof.yelpUrl?.trim();
  if (yelp) lines.push(`yelp: ${yelp}`);
  return lines.join("\n").slice(0, 4000);
}

export function parseClaimProof(proof?: ClaimProofInput | string): {
  applicantMessage: string | null;
  verificationDetails: string | null;
  error?: string;
} {
  if (typeof proof === "string") {
    return {
      applicantMessage: proof.trim() ? proof.trim().slice(0, 1000) : null,
      verificationDetails: null,
    };
  }
  if (!proof) {
    return { applicantMessage: null, verificationDetails: null };
  }
  const phone = proof.phone?.trim() ?? "";
  if (!phone) {
    return {
      applicantMessage: null,
      verificationDetails: null,
      error: "Укажите телефон для связи.",
    };
  }
  const links = [
    proof.website,
    proof.instagramUrl,
    proof.facebookUrl,
    proof.yelpUrl,
  ].filter((v) => Boolean(v?.trim()));
  if (links.length === 0) {
    return {
      applicantMessage: null,
      verificationDetails: null,
      error: "Добавьте хотя бы одну ссылку как доказательство.",
    };
  }
  return {
    verificationDetails: buildClaimVerificationDetails(proof),
    applicantMessage:
      typeof proof.message === "string" && proof.message.trim()
        ? proof.message.trim().slice(0, 1000)
        : null,
  };
}

export type {
  ClaimProofInput,
  ClaimStateResult,
  ClaimSubmitResult,
};
