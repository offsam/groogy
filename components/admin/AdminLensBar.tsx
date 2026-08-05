"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Eye, Layers, UserRound } from "lucide-react";
import { AdminChangeCategoryButton } from "@/components/business/AdminChangeCategoryButton";
import { AdminChangeProfessionalCategoryButton } from "@/components/admin/AdminChangeProfessionalCategoryButton";
import { AdminDeleteBusinessButton } from "@/components/business/AdminDeleteBusinessButton";
import { AdminLiveSectionPreviewModal } from "@/components/admin/AdminLiveSectionPreviewModal";
import {
  AdminPublishedEnrichButton,
  type AdminEnrichQueueTarget,
} from "@/components/admin/AdminPublishedEnrichButton";
import { AdminPublishedDuplicatesButton } from "@/components/admin/AdminPublishedDuplicatesButton";
import { AdminEntitySourcesButton } from "@/components/admin/AdminEntitySourcesButton";
import { AdminPasteEnrichButton } from "@/components/admin/AdminPasteEnrichButton";
import type { MoveSectionKey } from "@/lib/admin/move-entity-section";
import { cn } from "@/lib/utils";
import type { Business, Category } from "@/types/business";
import type { Professional } from "@/types/professional";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const chip =
  "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50";

export type AdminLensViewAs = "owner" | "visitor";

export type AdminLensSimpleKind =
  | "event"
  | "job"
  | "service"
  | "transfer"
  | "marketplace"
  | "lechu"
  | "church";

/**
 * Queue / Review preview: identical live AdminLensBar + Publish only.
 * Enrich / duplicates / paste use the same live components + scripts.
 */
export type AdminLensDraft = {
  onPublish: () => void;
  publishLabel?: string;
  publishPending?: boolean;
  publishDisabled?: boolean;
  statusLabel?: string;
  /** Where enrich / paste / duplicates write before publish. */
  queue: AdminEnrichQueueTarget;
  /** Same «Категория» chip dialog as live (queue slug write). */
  categorySlot?: ReactNode;
  /** «Раздел» opens parent hub switcher instead of live move modal. */
  onSectionClick?: () => void;
  onEnriched?: () => void;
};

const SIMPLE_TO_SECTION: Record<AdminLensSimpleKind, MoveSectionKey> = {
  event: "events",
  job: "jobs",
  service: "services",
  transfer: "transfers",
  marketplace: "marketplace",
  lechu: "lechu",
  church: "churches",
};

type BaseProps = {
  draft?: AdminLensDraft;
};

type Props = BaseProps &
  (
    | {
        kind: "business";
        business: Business;
        /** Live only — draft uses `draft.categorySlot`. */
        categories?: Category[];
        showDelete?: boolean;
      }
    | {
        kind: "professional";
        professional: Professional;
        /** Live only — draft uses `draft.categorySlot`. */
        categories?: Category[];
        viewAs?: AdminLensViewAs;
        onViewAsChange?: (view: AdminLensViewAs) => void;
      }
    | {
        kind: "church";
        entityId: string;
        slug: string;
        title: string;
        viewAs?: AdminLensViewAs;
        onViewAsChange?: (view: AdminLensViewAs) => void;
      }
    | {
        kind: Exclude<AdminLensSimpleKind, "church">;
        entityId: string;
        slug?: string;
        title?: string;
      }
  );

/**
 * Admin-only control strip on live public cards.
 * Pass `draft` for Review/queue preview — same chrome + Опубликовать.
 */
export function AdminLensBar(props: Props) {
  const [sectionOpen, setSectionOpen] = useState(false);
  const draft = props.draft;
  const isDraft = Boolean(draft);
  const viewAs =
    props.kind === "professional" || props.kind === "church"
      ? props.viewAs ?? "visitor"
      : null;

  const entityId =
    props.kind === "business"
      ? props.business.id
      : props.kind === "professional"
        ? props.professional.id
        : props.entityId;
  const slug =
    props.kind === "business"
      ? props.business.slug
      : props.kind === "professional"
        ? props.professional.slug
        : props.slug;
  const title =
    props.kind === "business"
      ? props.business.name
      : props.kind === "professional"
        ? props.professional.displayName
        : props.title || props.slug || "Карточка";
  const fromSection: MoveSectionKey =
    props.kind === "business"
      ? "businesses"
      : props.kind === "professional"
        ? "professionals"
        : SIMPLE_TO_SECTION[props.kind];
  const supportsPaste =
    props.kind === "business" ||
    props.kind === "professional" ||
    props.kind === "church";
  const supportsAutoEnrich =
    props.kind === "business" ||
    props.kind === "professional" ||
    props.kind === "church" ||
    props.kind === "event" ||
    props.kind === "job" ||
    props.kind === "service" ||
    props.kind === "transfer" ||
    props.kind === "marketplace" ||
    props.kind === "lechu";
  const supportsDuplicates =
    props.kind === "business" ||
    props.kind === "professional" ||
    props.kind === "event" ||
    props.kind === "job" ||
    props.kind === "service" ||
    props.kind === "transfer" ||
    props.kind === "marketplace" ||
    props.kind === "lechu";

  return (
    <>
      <div
        aria-label="Управление карточкой (админ)"
        className="flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2"
      >
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800/80">
          Админ
        </span>

        {isDraft ? (
          <span className="rounded-full border border-amber-300/80 bg-amber-100/80 px-2.5 py-1 text-[11px] font-medium text-amber-950">
            {draft?.statusLabel || "Не опубликовано"}
          </span>
        ) : null}

        {isDraft && draft ? (
          <button
            aria-busy={draft.publishPending || undefined}
            className={cn(
              chip,
              "border-brand-blue/40 bg-brand-blue text-white hover:bg-brand-blue/90 hover:text-white disabled:opacity-80",
              draft.publishPending &&
                "pointer-events-none ring-2 ring-brand-blue/35 ring-offset-1 ring-offset-amber-50",
            )}
            disabled={draft.publishDisabled || draft.publishPending}
            type="button"
            onClick={draft.onPublish}
          >
            {draft.publishPending ? (
              <>
                <BrandPinLoader size="sm" />
                Публикую…
              </>
            ) : (
              draft.publishLabel || "Опубликовать"
            )}
          </button>
        ) : null}

        {(props.kind === "professional" || props.kind === "church") &&
        props.onViewAsChange &&
        !isDraft ? (
          <div className="flex overflow-hidden rounded-full border border-slate-200 bg-white">
            <button
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition",
                viewAs === "visitor"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
              type="button"
              onClick={() => props.onViewAsChange?.("visitor")}
            >
              <Eye aria-hidden className="size-3.5" />
              Пользователь
            </button>
            <button
              className={cn(
                "inline-flex items-center gap-1 border-l border-slate-200 px-2.5 py-1 text-xs font-medium transition",
                viewAs === "owner"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
              type="button"
              onClick={() => props.onViewAsChange?.("owner")}
            >
              <UserRound aria-hidden className="size-3.5" />
              Владелец
            </button>
          </div>
        ) : null}

        <button
          className={chip}
          type="button"
          onClick={() => {
            if (draft?.onSectionClick) {
              draft.onSectionClick();
              return;
            }
            if (!isDraft) setSectionOpen(true);
          }}
        >
          <Layers aria-hidden className="size-3.5" />
          Раздел
        </button>

        {isDraft && draft?.categorySlot
          ? draft.categorySlot
          : !isDraft && props.kind === "business" ? (
              <AdminChangeCategoryButton
                businessId={props.business.id}
                businessSlug={props.business.slug}
                categories={props.categories ?? []}
                currentCategoryId={props.business.categoryId}
              />
            ) : null}
        {!isDraft && props.kind === "professional" ? (
          <AdminChangeProfessionalCategoryButton
            categories={props.categories ?? []}
            currentCategoryId={props.professional.categoryId}
            professionalId={props.professional.id}
            professionalSlug={props.professional.slug}
          />
        ) : null}

        {supportsAutoEnrich ? (
          <AdminPublishedEnrichButton
            disabled={draft?.publishDisabled}
            entityId={isDraft && draft ? draft.queue.id : entityId}
            kind={props.kind}
            onEnriched={draft?.onEnriched}
            queue={isDraft && draft ? draft.queue : undefined}
            slug={slug}
          />
        ) : null}

        {isDraft && draft ? (
          <AdminPasteEnrichButton
            disabled={draft.publishDisabled}
            entityId={draft.queue.id}
            kind={
              draft.queue.source === "import_review"
                ? "import_review"
                : "recommendation"
            }
            variant="chip"
          />
        ) : supportsPaste ? (
          <AdminPasteEnrichButton
            entityId={entityId}
            kind={props.kind === "church" ? "church" : props.kind}
            slug={slug || ""}
          />
        ) : null}

        {supportsDuplicates ? (
          <AdminPublishedDuplicatesButton
            disabled={draft?.publishDisabled}
            entityId={isDraft && draft ? draft.queue.id : entityId}
            kind={props.kind}
            queue={isDraft && draft ? draft.queue : undefined}
            slug={slug}
          />
        ) : null}

        {!isDraft &&
        (props.kind === "business" || props.kind === "professional") ? (
          <AdminEntitySourcesButton entityId={entityId} kind={props.kind} />
        ) : null}

        {!isDraft && props.kind === "business" ? (
          <>
            <Link
              className={chip}
              href={`/admin/businesses/${props.business.id}/edit`}
            >
              Admin
            </Link>
            {props.showDelete !== false ? (
              <AdminDeleteBusinessButton
                businessId={props.business.id}
                businessName={props.business.name}
                slug={props.business.slug}
              />
            ) : null}
          </>
        ) : null}

        {!isDraft && props.kind === "church" ? (
          <Link
            className={chip}
            href={`/admin/catalog/churches/${props.entityId}/edit`}
          >
            Редактировать
          </Link>
        ) : null}
      </div>

      {!isDraft ? (
        <AdminLiveSectionPreviewModal
          entityId={entityId}
          fromSection={fromSection}
          open={sectionOpen}
          title={title}
          onClose={() => setSectionOpen(false)}
        />
      ) : null}
    </>
  );
}
