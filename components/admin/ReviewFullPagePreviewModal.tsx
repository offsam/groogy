"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, X } from "lucide-react";
import { BusinessProfileView } from "@/components/business/profile/BusinessProfileView";
import { ProfessionalProfileView } from "@/components/professional/ProfessionalProfileView";
import { EventProfileView } from "@/components/events/EventProfileView";
import { EventCard } from "@/components/events/EventCard";
import { JobProfileView } from "@/components/jobs/JobProfileView";
import { JobCard } from "@/components/jobs/JobCard";
import { MarketplaceListingProfileView } from "@/components/marketplace/MarketplaceListingProfileView";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { LechuProfileView } from "@/components/lechu/LechuProfileView";
import { LechuCard } from "@/components/lechu/LechuCard";
import { TransferProfileView } from "@/components/transfers/TransferProfileView";
import { TransferCard } from "@/components/transfers/TransferCard";
import { ServiceProfileView } from "@/components/services/ServiceProfileView";
import { ServiceCard } from "@/components/services/ServiceCard";
import {
  RealEstateCard,
  type RealEstateCardItem,
} from "@/components/real-estate/RealEstateCard";
import { Button } from "@/components/ui/Button";
import { ReviewPreviewEnrichPanel } from "@/components/admin/ReviewPreviewEnrichPanel";
import { AdminPasteEnrichButton } from "@/components/admin/AdminPasteEnrichButton";
import { saveImportReviewItemAction } from "@/lib/import-review/actions";
import {
  REVIEW_HUB_OPTIONS,
  hubPreviewLabel,
  hubToImportTypes,
  importTypesToHub,
  type ReviewHubOption,
} from "@/lib/import-review/hub-preview";
import {
  IMPORT_PREVIEW_KIND_HINTS,
  IMPORT_PREVIEW_KIND_LABELS,
  resolveImportPreviewKind,
  type ImportPreviewKind,
} from "@/lib/import-review/preview-section";
import {
  importReviewItemToPreviewFields,
  importReviewToBusinessPreview,
  importReviewToEventPreview,
  importReviewToJobPreview,
  importReviewToOfferPreviews,
  importReviewToProfessionalPreview,
} from "@/lib/import-review/to-business-preview";
import { importReviewToListingPreview } from "@/lib/import-review/to-listing-preview";
import {
  categoriesForPreviewHub,
  type ReviewCategoryOption,
} from "@/lib/import-review/category-options";
import type { PlatformSectionKey } from "@/lib/platform/sections";
import type { ImportReviewItem } from "@/types/import-review";
import type { Listing } from "@/types/listing";

type Props = {
  item: ImportReviewItem;
  open: boolean;
  onClose: () => void;
  categories?: ReviewCategoryOption[];
};

function initialHub(item: ImportReviewItem): PlatformSectionKey {
  return (
    importTypesToHub(item.target_collection, item.entity_type) ?? "businesses"
  );
}

function hubToPreviewKind(hub: PlatformSectionKey): ImportPreviewKind {
  switch (hub) {
    case "real_estate":
      return "real_estate";
    case "lechu":
      return "lechu";
    case "transfers":
      return "transfers";
    case "jobs":
      return "jobs";
    case "events":
      return "events";
    case "professionals":
      return "services";
    case "businesses":
      return "business";
    case "marketplace":
    default:
      return "marketplace";
  }
}

function listingToRealEstateCardItem(listing: Listing): RealEstateCardItem {
  return {
    id: listing.id,
    title: listing.title,
    slug: listing.id,
    city: listing.city,
    priceAmount: listing.priceAmount,
    priceCurrency: listing.priceCurrency,
    offerKind:
      (listing.marketplace?.transactionType as string | undefined) === "rent"
        ? "rent"
        : "sell",
    coverUrl: listing.media?.[0]?.publicUrl ?? null,
    paymentMethods: listing.paymentMethods ?? null,
  };
}

function FeedTeaser({
  hub,
  listing,
}: {
  hub: PlatformSectionKey;
  listing: Listing;
}) {
  if (hub === "lechu") {
    return <LechuCard listing={listing} preview />;
  }
  if (hub === "transfers") {
    return <TransferCard listing={listing} preview />;
  }
  if (hub === "real_estate") {
    return <RealEstateCard item={listingToRealEstateCardItem(listing)} preview />;
  }
  return <ListingCard listing={listing} preview />;
}

function ListingHubFullPagePreview({
  item,
  hub,
}: {
  item: ImportReviewItem;
  hub: PlatformSectionKey;
}) {
  const fields = importReviewItemToPreviewFields(item);
  const kind = hubToPreviewKind(hub);
  const listing = importReviewToListingPreview(fields, kind);

  let profile = (
    <MarketplaceListingProfileView listing={listing} preview />
  );
  if (hub === "lechu") {
    profile = <LechuProfileView listing={listing} preview />;
  } else if (hub === "transfers") {
    profile = <TransferProfileView listing={listing} preview />;
  }

  return (
    <div className="space-y-6">
      {profile}
      <div className="mx-auto max-w-sm opacity-90">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Карточка в ленте
        </p>
        <FeedTeaser hub={hub} listing={listing} />
      </div>
    </div>
  );
}

function EventFullPagePreview({ item }: { item: ImportReviewItem }) {
  const fields = importReviewItemToPreviewFields(item);
  const event = importReviewToEventPreview(fields);
  return (
    <div className="space-y-6">
      <EventProfileView event={event} preview />
      <div className="mx-auto max-w-sm">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Карточка в ленте
        </p>
        <EventCard event={event} preview />
      </div>
    </div>
  );
}

function JobFullPagePreview({ item }: { item: ImportReviewItem }) {
  const fields = importReviewItemToPreviewFields(item);
  const job = importReviewToJobPreview(fields);
  return (
    <div className="space-y-6">
      <JobProfileView job={job} preview />
      <div className="mx-auto max-w-sm">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Карточка в ленте
        </p>
        <JobCard job={job} preview />
      </div>
    </div>
  );
}

export function ServiceFullPagePreview({ item }: { item: ImportReviewItem }) {
  const fields = importReviewItemToPreviewFields(item);
  const listing = importReviewToListingPreview(fields, "services");
  return (
    <div className="space-y-6">
      <ServiceProfileView listing={listing} preview />
      <div className="mx-auto max-w-sm">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Карточка в ленте
        </p>
        <ServiceCard listing={listing} preview />
      </div>
    </div>
  );
}

export function ReviewFullPagePreviewModal({
  item,
  open,
  onClose,
  categories = [],
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hub, setHub] = useState<PlatformSectionKey>(() => initialHub(item));
  const [category, setCategory] = useState(item.category ?? "");

  useEffect(() => {
    if (!open) return;
    setHub(initialHub(item));
    setCategory(item.category ?? "");
    setError(null);
    setMessage(null);
  }, [open, item.id, item.entity_type, item.target_collection, item.category]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const draftTypes = hubToImportTypes(hub);
  const previewItem = useMemo(() => {
    const next = {
      ...item,
      category: category.trim() || null,
    };
    if (!draftTypes) return next;
    return {
      ...next,
      entity_type: draftTypes.entity_type,
      target_collection: draftTypes.target_collection,
    };
  }, [item, draftTypes, category]);

  const fields = useMemo(
    () => importReviewItemToPreviewFields(previewItem),
    [previewItem],
  );
  const categoryOptions = useMemo(
    () => categoriesForPreviewHub(categories, hub),
    [categories, hub],
  );
  const showCategoryPicker = hub === "businesses" || hub === "professionals";
  const categoryName =
    categoryOptions.find((c) => c.slug === category)?.name ||
    (category.trim() || null);

  const business = useMemo(() => {
    const base = importReviewToBusinessPreview(fields);
    return {
      ...base,
      categorySlug: category.trim() || null,
      categoryName: categoryName || base.categoryName,
    };
  }, [fields, category, categoryName]);
  const professional = useMemo(() => {
    const base = importReviewToProfessionalPreview(fields);
    return {
      ...base,
      categorySlug: category.trim() || null,
      categoryName: categoryName || base.categoryName,
      headline: categoryName || base.headline,
    };
  }, [fields, category, categoryName]);
  const offers = useMemo(() => importReviewToOfferPreviews(fields), [fields]);
  const previewKind = resolveImportPreviewKind(previewItem);

  const typeDirty =
    Boolean(draftTypes) &&
    (draftTypes?.entity_type !== item.entity_type ||
      draftTypes?.target_collection !== item.target_collection);
  const categoryDirty =
    (category.trim() || null) !== (item.category?.trim() || null);
  const dirty = typeDirty || categoryDirty;

  const locked =
    item.review_status === "approved" ||
    item.review_status === "rejected" ||
    item.review_status === "duplicate";

  if (!open) return null;

  function onPick(option: ReviewHubOption) {
    if (!option.selectable || locked) return;
    setHub(option.key);
    setError(null);
    setMessage(null);
  }

  function onSave() {
    if (locked) return;
    if (!dirty) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const fieldsToSave: {
        entity_type?: NonNullable<typeof draftTypes>["entity_type"];
        target_collection?: NonNullable<typeof draftTypes>["target_collection"];
        category?: string | null;
      } = {};
      if (typeDirty && draftTypes) {
        fieldsToSave.entity_type = draftTypes.entity_type;
        fieldsToSave.target_collection = draftTypes.target_collection;
      }
      if (categoryDirty && showCategoryPicker) {
        fieldsToSave.category = category.trim() || null;
      }
      const res = await saveImportReviewItemAction({
        id: item.id,
        fields: fieldsToSave,
      });
      if (!res.ok) {
        setError(res.message || "Не удалось сохранить");
        return;
      }
      setMessage(res.message || "Сохранено");
      router.refresh();
    });
  }

  let page = null;
  if (hub === "businesses") {
    page = (
      <BusinessProfileView
        autoClaim={false}
        business={business}
        businessSlug={business.slug}
        currentUserId={null}
        isAdmin={false}
        isOwner={false}
        jobs={[]}
        myReview={null}
        mySession={null}
        offers={offers}
        preview
        reviews={[]}
        similar={[]}
      />
    );
  } else if (hub === "professionals") {
    page = (
      <ProfessionalProfileView
        currentUserId={null}
        isOwner={false}
        preview
        professional={professional}
        services={offers.map((o, index) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          priceMode:
            o.priceMode === "fixed" ||
            o.priceMode === "from" ||
            o.priceMode === "range" ||
            o.priceMode === "free"
              ? o.priceMode
              : "contact",
          priceAmount: o.priceAmount,
          priceMin: o.priceMin,
          priceMax: o.priceMax,
          currency: o.currency,
          priceUnit: typeof o.priceUnit === "string" ? o.priceUnit : null,
          durationMinutes: null,
          sortOrder: index * 10,
        }))}
      />
    );
  } else if (hub === "events") {
    page = <EventFullPagePreview item={previewItem} />;
  } else if (hub === "jobs") {
    page = <JobFullPagePreview item={previewItem} />;
  } else if (
    hub === "marketplace" ||
    hub === "real_estate" ||
    hub === "lechu" ||
    hub === "transfers"
  ) {
    page = <ListingHubFullPagePreview hub={hub} item={previewItem} />;
  } else {
    page = (
      <p className="text-sm text-slate-500">
        Превью для этого раздела пока недоступно.
      </p>
    );
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1200] flex flex-col bg-white"
      role="dialog"
    >
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-2 px-3 py-2.5 sm:items-center sm:gap-3 sm:px-5 sm:py-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">
              <Eye className="size-3.5" />
              <span className="sm:hidden">Превью</span>
              <span className="hidden sm:inline">
                Предварительный просмотр · как у пользователя
              </span>
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600 sm:text-sm">
              {hubPreviewLabel(hub)} · {IMPORT_PREVIEW_KIND_HINTS[previewKind]}
            </p>
          </div>
          <button
            aria-label="Закрыть"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            type="button"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="border-t border-slate-100 bg-white px-3 py-2 sm:px-5 sm:py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:mb-2 sm:text-[11px]">
            Посмотреть как
          </p>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {REVIEW_HUB_OPTIONS.map((option) => {
              const active = hub === option.key;
              const disabled = !option.selectable || locked;
              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(option)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition sm:px-3 sm:py-1.5 sm:text-sm ${
                    active
                      ? "border-brand-blue bg-brand-blue text-white"
                      : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                  } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  title={option.disabledReason || option.hint}
                >
                  {option.title}
                </button>
              );
            })}
          </div>

          {showCategoryPicker ? (
            <div className="mt-2 w-full sm:mt-3 sm:max-w-md">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Категория
                </span>
                <select
                  disabled={locked || pending}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 sm:py-2 sm:text-sm"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setError(null);
                    setMessage(null);
                  }}
                >
                  <option value="">Без категории</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                  {category &&
                  !categoryOptions.some((c) => c.slug === category) ? (
                    <option value={category}>{category}</option>
                  ) : null}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-white">
        <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 sm:py-10">
          {page}
        </div>
      </div>

      <footer className="sticky bottom-0 border-t border-slate-200 bg-white px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-3">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              type="button"
              className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              disabled={pending || locked || !dirty}
              onClick={onSave}
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  <span className="sm:hidden">…</span>
                  <span className="hidden sm:inline">Сохранение…</span>
                </>
              ) : (
                "Сохранить"
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              onClick={onClose}
            >
              Закрыть
            </Button>
          </div>

          <div className="flex w-full gap-2 overflow-x-auto [scrollbar-width:none] sm:w-auto sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            <ReviewPreviewEnrichPanel itemId={item.id} disabled={locked} />
            {!locked ? (
              <AdminPasteEnrichButton
                kind="import_review"
                entityId={item.id}
                variant="button"
              />
            ) : null}
          </div>

          {dirty ? (
            <span className="text-[11px] leading-snug text-amber-700 sm:text-xs">
              {typeDirty && categoryDirty
                ? "Тип и категория изменены — сохраните"
                : typeDirty
                  ? "Тип изменён — сохраните, чтобы Approve шёл в этот раздел"
                  : "Категория изменена — сохраните"}
            </span>
          ) : (
            <span className="hidden text-xs text-slate-500 sm:inline">
              Показан тип: {IMPORT_PREVIEW_KIND_LABELS[previewKind]}
              {showCategoryPicker && category
                ? ` · ${
                    categoryOptions.find((c) => c.slug === category)?.name ||
                    category
                  }`
                : ""}
            </span>
          )}
          {error ? (
            <span className="text-sm text-red-700" role="alert">
              {error}
            </span>
          ) : null}
          {message ? (
            <span className="text-sm text-emerald-700">{message}</span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
