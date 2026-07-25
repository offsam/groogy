"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  adminSetBusinessStatusAction,
  mergeBusinessesAction,
} from "@/lib/business/admin-actions";
import { adminDeleteBusinessAction } from "@/lib/admin/actions";
import type { AdminBusinessRow, DuplicatePair } from "@/lib/business/admin-queries";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";

const STATUS_LABELS: Record<AdminBusinessRow["status"], string> = {
  draft: "Черновик",
  pending: "На проверке",
  approved: "Опубликован",
  rejected: "Отклонён",
  archived: "Архив",
};

type AdminBusinessesPanelProps = {
  pairs: DuplicatePair[];
  businesses: AdminBusinessRow[];
};

function BusinessCard({
  row,
  badge,
}: {
  row: AdminBusinessRow;
  badge?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {badge ? (
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {badge}
            </p>
          ) : null}
          <Link
            className="font-semibold text-slate-900 hover:underline"
            href={`/business/${row.slug}`}
            target="_blank"
          >
            {row.name}
          </Link>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{row.slug}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {STATUS_LABELS[row.status]}
        </span>
      </div>
      <dl className="mt-2 grid gap-1 text-slate-600">
        <div>
          <dt className="inline text-slate-400">Телефон: </dt>
          <dd className="inline">{row.phone ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">Город: </dt>
          <dd className="inline">{row.city ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">Адрес: </dt>
          <dd className="inline">{row.address_line ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">Офферы: </dt>
          <dd className="inline">{row.offers_count}</dd>
        </div>
      </dl>
    </div>
  );
}

export function AdminBusinessesPanel({
  pairs,
  businesses,
}: AdminBusinessesPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "Ошибка");
        return;
      }
      setMessage(result.message ?? successFallback);
      router.refresh();
    });
  }

  const active = businesses.filter((b) => b.status !== "archived");

  return (
    <div className="space-y-8">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Предложенные дубликаты
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Совпадение по телефону или нормализованному имени. Слева —
            рекомендуемый оригинал.
          </p>
        </div>

        {pairs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Дубликатов не найдено.
          </p>
        ) : (
          <ul className="space-y-4">
            {pairs.map((pair) => (
              <li
                key={pair.id}
                className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4"
              >
                <p className="text-sm font-medium text-amber-900">
                  {pair.reasonLabel}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <BusinessCard badge="Оставить" row={pair.a} />
                  <BusinessCard badge="Дубликат" row={pair.b} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          mergeBusinessesAction({
                            keepId: pair.a.id,
                            dropId: pair.b.id,
                            keepSlug: pair.a.slug,
                            dropSlug: pair.b.slug,
                          }),
                        "Смержено",
                      )
                    }
                  >
                    {pending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Смержить → оставить «{pair.a.name.slice(0, 28)}
                    {pair.a.name.length > 28 ? "…" : ""}»
                  </Button>
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() =>
                      run(
                        () =>
                          mergeBusinessesAction({
                            keepId: pair.b.id,
                            dropId: pair.a.id,
                            keepSlug: pair.b.slug,
                            dropSlug: pair.a.slug,
                          }),
                        "Смержено",
                      )
                    }
                  >
                    Наоборот: оставить «{pair.b.name.slice(0, 24)}
                    {pair.b.name.length > 24 ? "…" : ""}»
                  </Button>
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() =>
                      run(
                        () =>
                          adminSetBusinessStatusAction({
                            businessId: pair.b.id,
                            status: "archived",
                            slug: pair.b.slug,
                          }),
                        "Дубликат в архиве",
                      )
                    }
                  >
                    Только архивировать дубликат
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Все бизнесы ({active.length})
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Одобрить, редактировать или удалить (в архив).
            </p>
          </div>
          <Link
            className="inline-flex rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            href="/admin/businesses/new"
          >
            + Добавить бизнес
          </Link>
        </div>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {active.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  className="font-medium text-slate-900 hover:underline"
                  href={`/business/${row.slug}`}
                  target="_blank"
                >
                  {row.name}
                </Link>
                <p className="truncate text-xs text-slate-500">
                  {STATUS_LABELS[row.status]} · {row.city ?? "без города"} ·{" "}
                  {row.phone ?? "без телефона"} · офферов {row.offers_count}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.status !== "approved" ? (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          adminSetBusinessStatusAction({
                            businessId: row.id,
                            status: "approved",
                            slug: row.slug,
                          }),
                        "Опубликовано",
                      )
                    }
                  >
                    Одобрить
                  </Button>
                ) : null}
                {row.status !== "pending" ? (
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() =>
                      run(
                        () =>
                          adminSetBusinessStatusAction({
                            businessId: row.id,
                            status: "pending",
                            slug: row.slug,
                          }),
                        "Снято с публикации",
                      )
                    }
                  >
                    В pending
                  </Button>
                ) : null}
                <Link
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
                  href={`/admin/businesses/${row.id}/edit`}
                >
                  Редактировать
                </Link>
                <Button
                  disabled={pending}
                  variant="secondary"
                  onClick={() =>
                    run(
                      () =>
                        adminDeleteBusinessAction({
                          businessId: row.id,
                          slug: row.slug,
                        }),
                      "Удалено (архив)",
                    )
                  }
                >
                  Удалить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
