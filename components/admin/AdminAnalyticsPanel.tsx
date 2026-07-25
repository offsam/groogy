import Link from "next/link";
import type { AdminAnalytics } from "@/lib/admin/queries";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        {value}
      </p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function AdminAnalyticsPanel({ stats }: { stats: AdminAnalytics }) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-slate-900">Посещения</h2>
        <p className="mt-1 text-sm text-slate-500">
          Считаются просмотры страниц на сайте (без раздела /admin).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Сегодня" value={stats.page_views_today} />
          <StatCard label="7 дней" value={stats.page_views_7d} />
          <StatCard label="30 дней" value={stats.page_views_30d} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">
          Открытия контактов
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Сколько раз нажали «Показать контакты» на карточке бизнеса или
          предложения.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Сегодня" value={stats.contact_reveals_today} />
          <StatCard label="7 дней" value={stats.contact_reveals_7d} />
          <StatCard label="30 дней" value={stats.contact_reveals_30d} />
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Топ по открытиям за 7 дней
          </h3>
          {stats.top_contact_reveals_7d.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Пока нет открытий контактов.
            </p>
          ) : (
            <ol className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {stats.top_contact_reveals_7d.map((row) => {
                const key = `${row.business_id ?? row.business_slug}-${row.offer_id ?? "biz"}`;
                const href = row.offer_slug
                  ? `/business/${row.business_slug}/offers/${row.offer_slug}`
                  : `/business/${row.business_slug}`;
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        className="truncate font-medium text-slate-900 hover:underline"
                        href={href}
                      >
                        {row.business_name}
                      </Link>
                      {row.offer_slug ? (
                        <p className="truncate text-xs text-slate-500">
                          оффер · {row.offer_slug}
                        </p>
                      ) : (
                        <p className="truncate text-xs text-slate-500">
                          /business/{row.business_slug}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold text-slate-900">
                      {row.reveals}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Пользователи</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Всего" value={stats.users_total} />
          <StatCard label="Сегодня" value={stats.users_today} />
          <StatCard label="За 7 дней" value={stats.users_7d} />
          <StatCard label="Админы" value={stats.admins} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Каталог</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Бизнесы"
            value={stats.businesses_approved}
            hint={`из ${stats.businesses_total} · на проверке ${stats.businesses_pending}`}
          />
          <StatCard
            label="Новые бизнесы сегодня"
            value={stats.businesses_today}
          />
          <StatCard label="Активные офферы" value={stats.offers_active} />
          <StatCard label="Активные объявления" value={stats.listings_active} />
          <StatCard
            label="Жалобы на объявления"
            value={stats.listings_pending_reports}
          />
          <StatCard label="Отзывы на модерации" value={stats.reviews_pending} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">
          Топ страниц за 7 дней
        </h2>
        {stats.top_paths_7d.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Пока нет данных — откройте пару страниц сайта и обновите панель.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {stats.top_paths_7d.map((row) => (
              <li
                key={row.path}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <span className="truncate font-mono text-slate-700">
                  {row.path}
                </span>
                <span className="shrink-0 font-semibold text-slate-900">
                  {row.views}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
