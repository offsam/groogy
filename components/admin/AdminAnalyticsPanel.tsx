import Link from "next/link";
import type { AdminAnalytics } from "@/lib/admin/queries";

function formatInt(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

function formatAvg(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 10) return n.toFixed(1).replace(".", ",");
  return formatInt(n);
}

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
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums sm:mt-2 sm:text-3xl">
        {typeof value === "number" ? formatInt(value) : value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-snug text-slate-500 sm:text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function AdminAnalyticsPanel({ stats }: { stats: AdminAnalytics }) {
  const avgViews7d = stats.page_views_7d / 7;
  const avgViews30d = stats.page_views_30d / 30;
  const avgReveals7d = stats.contact_reveals_7d / 7;
  const revealRate7d =
    stats.page_views_7d > 0
      ? (stats.contact_reveals_7d / stats.page_views_7d) * 100
      : 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-3 py-3 sm:px-4 sm:py-4">
        <h2 className="text-sm font-semibold text-slate-900 sm:text-base">
          Для разговора с бизнесом
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 sm:text-sm">
          На сайт в среднем заходит{" "}
          <strong className="text-slate-900">
            ~{formatAvg(avgViews7d)} просмотров в день
          </strong>{" "}
          (за последние 7 дней). Контакты открывают{" "}
          <strong className="text-slate-900">
            ~{formatAvg(avgReveals7d)} раз в день
          </strong>
          {stats.page_views_7d > 0 ? (
            <>
              {" "}
              — это{" "}
              <strong className="text-slate-900">
                {formatAvg(revealRate7d)}%
              </strong>{" "}
              от просмотров
            </>
          ) : null}
          .
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Посещения
        </h2>
        <p className="mt-1 text-xs text-slate-500 sm:text-sm">
          Просмотры страниц на сайте (без /admin). Чем выше — тем живее
          аудитория.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-3 sm:gap-3">
          <StatCard
            label="Сегодня"
            value={stats.page_views_today}
            hint="просмотров"
          />
          <StatCard
            label="7 дней"
            value={stats.page_views_7d}
            hint={`~${formatAvg(avgViews7d)} / день`}
          />
          <StatCard
            label="30 дней"
            value={stats.page_views_30d}
            hint={`~${formatAvg(avgViews30d)} / день`}
          />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Открытия контактов
        </h2>
        <p className="mt-1 text-xs text-slate-500 sm:text-sm">
          Клики «Показать контакты» — прямой интерес к бизнесу. Это метрика,
          которую можно показывать владельцам карточек.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-3 sm:gap-3">
          <StatCard label="Сегодня" value={stats.contact_reveals_today} />
          <StatCard
            label="7 дней"
            value={stats.contact_reveals_7d}
            hint={`~${formatAvg(avgReveals7d)} / день`}
          />
          <StatCard
            label="30 дней"
            value={stats.contact_reveals_30d}
            hint={
              stats.page_views_7d > 0
                ? `${formatAvg(revealRate7d)}% от просмотров за 7д`
                : undefined
            }
          />
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Топ карточек по открытиям · 7 дней
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Кому уже идёт спрос — и кого можно звать в платную/верификацию.
          </p>
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
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm sm:gap-4 sm:px-4 sm:py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        className="block truncate font-medium text-slate-900 hover:underline"
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
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                      {formatInt(row.reveals)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Пользователи
        </h2>
        <p className="mt-1 text-xs text-slate-500 sm:text-sm">
          Регистрации — рост своей аудитории, не только гостевой трафик.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-4 sm:gap-3">
          <StatCard label="Всего" value={stats.users_total} />
          <StatCard label="Сегодня" value={stats.users_today} hint="новые" />
          <StatCard label="За 7 дней" value={stats.users_7d} hint="новые" />
          <StatCard label="Админы" value={stats.admins} />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Каталог
        </h2>
        <p className="mt-1 text-xs text-slate-500 sm:text-sm">
          Объём и «дыры» в контенте — что ещё надо дотянуть.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-3 sm:gap-3">
          <StatCard
            label="Бизнесы в каталоге"
            value={stats.businesses_approved}
            hint={`из ${formatInt(stats.businesses_total)} · на проверке ${formatInt(stats.businesses_pending)}`}
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
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Топ страниц · 7 дней
        </h2>
        <p className="mt-1 text-xs text-slate-500 sm:text-sm">
          Куда реально ходят — поиск, хабы, конкретные карточки.
        </p>
        {stats.top_paths_7d.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Пока нет данных — откройте пару страниц сайта и обновите.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {stats.top_paths_7d.map((row) => (
              <li
                key={row.path}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm sm:gap-4 sm:px-4 sm:py-3"
              >
                <span className="min-w-0 truncate font-mono text-xs text-slate-700 sm:text-sm">
                  {row.path}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                  {formatInt(row.views)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
