import {
  CONDITION_OPTIONS,
  TRANSACTION_OPTIONS,
} from "@/lib/listings/constants";
import type { ListingCondition, ListingTransactionType } from "@/types/listing";

export function parseMarketplaceSearchParams(
  searchParams: Record<string, string | undefined>,
) {
  const sortRaw = searchParams.sort;
  const sort =
    sortRaw === "price_asc" || sortRaw === "price_desc"
      ? sortRaw
      : ("newest" as const);

  const transactionRaw = searchParams.transactionType;
  const transactionType = TRANSACTION_OPTIONS.some((o) => o.value === transactionRaw)
    ? (transactionRaw as ListingTransactionType)
    : undefined;

  const conditionRaw = searchParams.condition;
  const condition = CONDITION_OPTIONS.some((o) => o.value === conditionRaw)
    ? (conditionRaw as ListingCondition)
    : undefined;

  const pageRaw = Number(searchParams.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const minPriceRaw = searchParams.minPrice;
  const maxPriceRaw = searchParams.maxPrice;

  return {
    categorySlug: searchParams.category || undefined,
    transactionType,
    condition,
    city: searchParams.city || undefined,
    minPrice: minPriceRaw ? Number(minPriceRaw) : undefined,
    maxPrice: maxPriceRaw ? Number(maxPriceRaw) : undefined,
    sort: sort as "newest" | "price_asc" | "price_desc",
    page,
  };
}
