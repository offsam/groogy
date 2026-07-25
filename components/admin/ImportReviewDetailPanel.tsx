"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  approveImportReviewItemAction,
  saveImportReviewItemAction,
  setImportReviewStatusAction,
  type DuplicateMatch,
  type ImportReviewActionResult,
} from "@/lib/import-review/actions";
import type { ImportReviewItem } from "@/types/import-review";
import {
  IMPORT_ENTITY_TYPE_LABELS,
  IMPORT_REVIEW_STATUS_LABELS,
  IMPORT_TARGET_COLLECTION_LABELS,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
  type ImportReviewEntityType,
  type ImportReviewStatus,
  type ImportReviewTargetCollection,
} from "@/types/import-review";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { getDisplayContacts } from "@/lib/import-review/contacts";

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function csv(values: string[] | null | undefined): string {
  return (values ?? []).join(", ");
}

function parseList(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STATUS_STYLES: Record<ImportReviewStatus, string> = {
  pending: "bg-amber-50 text-amber-900 border-amber-200",
  in_review: "bg-sky-50 text-sky-900 border-sky-200",
  approved: "bg-emerald-50 text-emerald-900 border-emerald-200",
  rejected: "bg-red-50 text-red-900 border-red-200",
  duplicate: "bg-slate-100 text-slate-800 border-slate-200",
  needs_more_info: "bg-orange-50 text-orange-900 border-orange-200",
  ready_to_publish: "bg-brand-blue/10 text-brand-blue-deep border-brand-blue/25",
};

type Props = {
  item: ImportReviewItem;
  categories: Array<{ id: string; slug: string; name: string; domain: string }>;
  filterQuery: string;
  nextPendingId?: string | null;
};

export function ImportReviewDetailPanel({
  item,
  categories,
  filterQuery,
  nextPendingId = null,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [rejectReason, setRejectReason] = useState("insufficient_data");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [status, setStatus] = useState<ImportReviewStatus>(item.review_status);

  useEffect(() => {
    setStatus(item.review_status);
  }, [item.id, item.review_status]);

  const [form, setForm] = useState({
    target_collection: (item.target_collection ??
      "private_specialists") as ImportReviewTargetCollection,
    entity_type: (item.entity_type ??
      "private_specialist") as ImportReviewEntityType,
    category: item.category ?? "",
    subcategory: item.subcategory ?? "",
    title: item.title ?? "",
    business_name: item.business_name ?? "",
    person_name: item.person_name ?? "",
    description: item.description ?? "",
    services: csv(item.services),
    price: item.price != null ? String(item.price) : "",
    currency: item.currency ?? "USD",
    city: item.city ?? "",
    state: item.state ?? "",
    phone: csv(item.phone),
    whatsapp: csv(item.whatsapp),
    telegram_username: item.telegram_username ?? "",
    telegram_user_id: item.telegram_user_id ?? "",
    instagram: csv(item.instagram),
    website: csv(item.website),
    email: csv(item.email),
    review_notes: item.review_notes ?? "",
  });

  const days = daysSince(item.source_posted_at);
  const locked =
    status === "approved" || status === "rejected" || status === "duplicate";

  const categoryOptions = useMemo(() => {
    const domainHint =
      form.target_collection === "marketplace" ||
      form.target_collection === "real_estate"
        ? "marketplace"
        : form.target_collection === "services" ||
            form.target_collection === "private_specialists"
          ? "services"
          : null;
    return domainHint
      ? categories.filter((c) => c.domain === domainHint)
      : categories;
  }, [categories, form.target_collection]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function goNextOrList(flash?: string) {
    const q = new URLSearchParams(filterQuery);
    if (flash) q.set("flash", flash);
    if (nextPendingId) {
      router.push(`/admin/import-review/${nextPendingId}?${q.toString()}`);
    } else {
      if (!q.get("status")) q.set("status", "pending");
      router.push(`/admin/import-review?${q.toString()}`);
    }
    router.refresh();
  }

  async function run(
    action: () => Promise<ImportReviewActionResult>,
    successFallback: string,
    opts?: {
      next?: boolean;
      nextFlash?: string;
      nextStatus?: ImportReviewStatus;
    },
  ) {
    setError(null);
    setMessage(null);
    setDuplicates([]);
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "Ошибка");
        setDuplicates(result.duplicates ?? []);
        return;
      }
      if (opts?.nextStatus) setStatus(opts.nextStatus);
      setMessage(result.message ?? successFallback);
      if (opts?.next) {
        goNextOrList(opts.nextFlash);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }

  function fieldsPayload() {
    return {
      target_collection: form.target_collection,
      entity_type: form.entity_type,
      category: form.category || null,
      subcategory: form.subcategory || null,
      title: form.title || null,
      business_name: form.business_name || null,
      person_name: form.person_name || null,
      description: form.description || null,
      services: parseList(form.services),
      price: form.price ? Number(form.price) : null,
      currency: form.currency || null,
      city: form.city || null,
      state: form.state || null,
      phone: parseList(form.phone),
      whatsapp: parseList(form.whatsapp),
      telegram_username: form.telegram_username || null,
      telegram_user_id: form.telegram_user_id || null,
      instagram: parseList(form.instagram),
      website: parseList(form.website),
      email: parseList(form.email),
      review_notes: form.review_notes || null,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/import-review?${filterQuery}`}
          className="text-sm text-brand-blue-deep hover:underline"
        >
          ← К очереди
        </Link>
        <div
          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${STATUS_STYLES[status]}`}
        >
          {IMPORT_REVIEW_STATUS_LABELS[status]}
        </div>
      </div>

      {error && <AuthAlert tone="error">{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}
      {duplicates.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Возможные дубликаты</p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                {d.kind}: {d.title || d.id} — {d.reason}
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            disabled={busy || locked}
            onClick={() =>
              run(
                () =>
                  approveImportReviewItemAction({ id: item.id, force: true }),
                "Одобрено принудительно",
                { next: true, nextFlash: "approved", nextStatus: "approved" },
              )
            }
          >
            Одобрить несмотря на совпадения
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Источник</h2>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-slate-500">Опубликовано в Telegram</dt>
              <dd>
                {item.source_posted_at
                  ? new Date(item.source_posted_at).toLocaleString("ru-RU")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Прошло</dt>
              <dd>{days != null ? `${days} дн.` : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Автор</dt>
              <dd>
                {item.source_author_display_name || "—"}
                {item.source_author_username
                  ? ` · @${item.source_author_username}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Telegram user ID</dt>
              <dd className="font-mono text-xs">
                {item.source_author_id || item.telegram_user_id || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Message IDs</dt>
              <dd className="font-mono text-xs">
                {(item.source_message_ids ?? []).join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">AI</dt>
              <dd>
                conf {item.ai_confidence ?? "—"} · {item.ai_decision || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Причина needs_review</dt>
              <dd className="text-amber-800">{item.ai_reason || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Duplicate / recurring</dt>
              <dd>
                {item.duplicate_status || "—"}
                {item.occurrence_count ? ` · ×${item.occurrence_count}` : ""}
                {item.recurring_cluster_id
                  ? ` · cluster ${item.recurring_cluster_id}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Медиа</dt>
              <dd>
                {item.photos_count > 0
                  ? `${item.photos_count} файл(ов), download_status=pending`
                  : "нет"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Публичные контакты</dt>
              <dd className="space-y-1 text-sm">
                {getDisplayContacts(item).length === 0 ? (
                  <span>нет контактов</span>
                ) : (
                  getDisplayContacts(item).map((c) =>
                    c.href ? (
                      <div key={`${c.kind}-${c.label}`}>
                        <a
                          className="text-brand-blue-deep underline"
                          href={c.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {c.label}
                        </a>
                      </div>
                    ) : (
                      <div key={`${c.kind}-${c.label}`}>{c.label}</div>
                    ),
                  )
                )}
                {item.source_url ? (
                  <div>
                    <a
                      className="inline-flex rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-brand-blue-deep hover:bg-slate-50"
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть оригинал
                    </a>
                  </div>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Технический блок</dt>
              <dd className="space-y-0.5 font-mono text-xs text-slate-500">
                <div>phone: {csv(item.phone) || "—"}</div>
                <div>whatsapp: {csv(item.whatsapp) || "—"}</div>
                <div>
                  telegram username:{" "}
                  {item.telegram_username
                    ? `@${item.telegram_username.replace(/^@/, "")}`
                    : "—"}
                </div>
                <div>
                  telegram user id: {item.telegram_user_id || item.source_author_id || "—"}
                </div>
                <div>instagram: {csv(item.instagram) || "—"}</div>
                <div>website: {csv(item.website) || "—"}</div>
                <div>email: {csv(item.email) || "—"}</div>
              </dd>
            </div>
          </dl>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">
              Исходный текст
            </h3>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
              {item.source_text || "—"}
            </pre>
          </div>

          <div>
            <button
              type="button"
              className="text-sm text-brand-blue-deep hover:underline"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "Скрыть raw JSON" : "Показать raw JSON"}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(item.raw_payload, null, 2)}
              </pre>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Карточка на платформе
          </h2>

          {locked && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Карточка в статусе «{IMPORT_REVIEW_STATUS_LABELS[status]}» —
              изменение статуса заблокировано.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">target_collection</span>
              <select
                disabled={locked || busy}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.target_collection}
                onChange={(e) =>
                  setField(
                    "target_collection",
                    e.target.value as ImportReviewTargetCollection,
                  )
                }
              >
                {Object.entries(IMPORT_TARGET_COLLECTION_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">entity_type</span>
              <select
                disabled={locked || busy}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.entity_type}
                onChange={(e) =>
                  setField(
                    "entity_type",
                    e.target.value as ImportReviewEntityType,
                  )
                }
              >
                {Object.entries(IMPORT_ENTITY_TYPE_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-500">category</span>
              <select
                disabled={locked || busy}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.category}
                onChange={(e) => setField("category", e.target.value)}
              >
                <option value="">—</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name} ({c.domain})
                  </option>
                ))}
                {form.category &&
                  !categoryOptions.some((c) => c.slug === form.category) && (
                    <option value={form.category}>{form.category}</option>
                  )}
              </select>
            </label>
          </div>

          {(form.target_collection === "marketplace" ||
            form.target_collection === "real_estate") && (
            <div className="rounded-lg border border-dashed border-slate-200 p-3 text-sm">
              <p className="mb-2 font-medium text-slate-700">Marketplace</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  label="Item title"
                  value={form.title}
                  disabled={locked || busy}
                  onChange={(v) => setField("title", v)}
                />
                <Field
                  label="Seller"
                  value={form.person_name}
                  disabled={locked || busy}
                  onChange={(v) => setField("person_name", v)}
                />
                <Field
                  label="Price"
                  value={form.price}
                  disabled={locked || busy}
                  onChange={(v) => setField("price", v)}
                />
                <Field
                  label="Currency"
                  value={form.currency}
                  disabled={locked || busy}
                  onChange={(v) => setField("currency", v)}
                />
              </div>
            </div>
          )}

          {(form.target_collection === "businesses" ||
            form.target_collection === "private_specialists" ||
            form.target_collection === "services" ||
            form.target_collection === "organizations") && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Business name"
                value={form.business_name}
                disabled={locked || busy}
                onChange={(v) => setField("business_name", v)}
              />
              <Field
                label="Person name"
                value={form.person_name}
                disabled={locked || busy}
                onChange={(v) => setField("person_name", v)}
              />
              <Field
                label="Title"
                value={form.title}
                disabled={locked || busy}
                onChange={(v) => setField("title", v)}
                className="sm:col-span-2"
              />
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-500">Services</span>
                <input
                  disabled={locked || busy}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.services}
                  onChange={(e) => setField("services", e.target.value)}
                  placeholder="через запятую"
                />
              </label>
            </div>
          )}

          {form.target_collection === "jobs" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Position"
                value={form.title}
                disabled={locked || busy}
                onChange={(v) => setField("title", v)}
              />
              <Field
                label="Employer"
                value={form.business_name}
                disabled={locked || busy}
                onChange={(v) => setField("business_name", v)}
              />
              <Field
                label="Compensation"
                value={form.price}
                disabled={locked || busy}
                onChange={(v) => setField("price", v)}
              />
            </div>
          )}

          {form.target_collection === "events" && (
            <div className="grid gap-2">
              <Field
                label="Event title"
                value={form.title}
                disabled={locked || busy}
                onChange={(v) => setField("title", v)}
              />
              <Field
                label="Organizer"
                value={form.person_name || form.business_name}
                disabled={locked || busy}
                onChange={(v) => setField("person_name", v)}
              />
            </div>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Description</span>
            <textarea
              disabled={locked || busy}
              rows={6}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              label="City"
              value={form.city}
              disabled={locked || busy}
              onChange={(v) => setField("city", v)}
            />
            <Field
              label="State"
              value={form.state}
              disabled={locked || busy}
              onChange={(v) => setField("state", v)}
            />
            <Field
              label="Phone"
              value={form.phone}
              disabled={locked || busy}
              onChange={(v) => setField("phone", v)}
            />
            <Field
              label="WhatsApp"
              value={form.whatsapp}
              disabled={locked || busy}
              onChange={(v) => setField("whatsapp", v)}
            />
            <Field
              label="Telegram username"
              value={form.telegram_username}
              disabled={locked || busy}
              onChange={(v) => setField("telegram_username", v)}
            />
            <Field
              label="Telegram user ID"
              value={form.telegram_user_id}
              disabled={locked || busy}
              onChange={(v) => setField("telegram_user_id", v)}
            />
            <Field
              label="Instagram"
              value={form.instagram}
              disabled={locked || busy}
              onChange={(v) => setField("instagram", v)}
            />
            <Field
              label="Website"
              value={form.website}
              disabled={locked || busy}
              onChange={(v) => setField("website", v)}
            />
            <Field
              label="Email"
              value={form.email}
              disabled={locked || busy}
              onChange={(v) => setField("email", v)}
              className="sm:col-span-2"
            />
          </div>

          {form.telegram_username ? (
            <p className="text-sm text-slate-600">
              Публичный контакт:{" "}
              <a
                className="text-brand-blue-deep underline"
                href={`https://t.me/${form.telegram_username.replace(/^@/, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                @{form.telegram_username.replace(/^@/, "")}
              </a>
            </p>
          ) : form.telegram_user_id ? (
            <p className="text-sm text-slate-500">
              Telegram без username (ID только в техническом блоке источника).
            </p>
          ) : null}

          {item.source_url ? (
            <a
              className="inline-flex w-fit rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-blue-deep hover:bg-slate-50"
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Открыть оригинал
            </a>
          ) : null}

          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Заметки модератора</span>
            <textarea
              disabled={locked || busy}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={form.review_notes}
              onChange={(e) => setField("review_notes", e.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button
              disabled={busy || locked}
              onClick={() =>
                run(
                  () =>
                    saveImportReviewItemAction({
                      id: item.id,
                      fields: fieldsPayload(),
                    }),
                  "Сохранено",
                )
              }
            >
              Сохранить
            </Button>
            <Button
              variant="secondary"
              disabled={busy || locked || status === "in_review"}
              onClick={() =>
                run(
                  () =>
                    setImportReviewStatusAction({
                      id: item.id,
                      status: "in_review",
                    }),
                  "В работе",
                  { nextStatus: "in_review" },
                )
              }
            >
              Начать проверку
            </Button>
            <Button
              disabled={busy || locked}
              onClick={() =>
                run(
                  async () => {
                    const saved = await saveImportReviewItemAction({
                      id: item.id,
                      fields: fieldsPayload(),
                    });
                    if (!saved.ok) return saved;
                    return approveImportReviewItemAction({ id: item.id });
                  },
                  "Одобрено",
                  { next: true, nextFlash: "approved", nextStatus: "approved" },
                )
              }
            >
              Одобрить
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                disabled={busy || locked}
              >
                {REJECT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REJECT_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={busy || locked}
                onClick={() =>
                  run(
                    () =>
                      setImportReviewStatusAction({
                        id: item.id,
                        status: "rejected",
                        rejectReason,
                        notes: form.review_notes || undefined,
                      }),
                    "Отклонено",
                    {
                      next: true,
                      nextFlash: "rejected",
                      nextStatus: "rejected",
                    },
                  )
                }
              >
                {busy ? "Отклоняем…" : "Отклонить"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="w-48 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                placeholder="UUID дубликата"
                value={duplicateOf}
                onChange={(e) => setDuplicateOf(e.target.value)}
                disabled={busy || locked}
              />
              <Button
                variant="secondary"
                disabled={busy || locked || !duplicateOf}
                onClick={() =>
                  run(
                    () =>
                      setImportReviewStatusAction({
                        id: item.id,
                        status: "duplicate",
                        duplicateOfItemId: duplicateOf,
                      }),
                    "Помечено как дубликат",
                    {
                      next: true,
                      nextFlash: "duplicate",
                      nextStatus: "duplicate",
                    },
                  )
                }
              >
                Дубликат
              </Button>
            </div>
            <Button
              variant="secondary"
              disabled={busy || locked}
              onClick={() =>
                run(
                  () =>
                    setImportReviewStatusAction({
                      id: item.id,
                      status: "needs_more_info",
                      notes:
                        form.review_notes.trim() ||
                        "Нужна дополнительная информация",
                    }),
                  "Нужна информация",
                  { nextStatus: "needs_more_info" },
                )
              }
            >
              Нужна информация
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void run(
                  () =>
                    saveImportReviewItemAction({
                      id: item.id,
                      fields: fieldsPayload(),
                    }),
                  "Сохранено",
                  { next: true },
                );
              }}
            >
              Следующая карточка
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`text-sm ${className ?? ""}`}>
      <span className="mb-1 block text-slate-500">{label}</span>
      <input
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
