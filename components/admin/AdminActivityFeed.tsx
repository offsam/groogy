import Link from "next/link";
import {
  ACTIVITY_KINDS,
  type ActivityFeedItem,
  type ActivityKind,
} from "@/lib/admin/activity-feed";

const KIND_LABEL: Record<ActivityKind | "all", string> = {
  all: "Все",
  page_view: "Заходы",
  search: "Поиск",
  click: "Нажатия",
  contact_reveal: "Контакты",
};

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function hrefFor(kind: string, actor?: string): string {
  const params = new URLSearchParams();
  if (kind && kind !== "all") params.set("kind", kind);
  if (actor) params.set("actor", actor);
  const qs = params.toString();
  return qs ? `/admin/analytics?${qs}` : "/admin/analytics";
}

export function AdminActivityFeed({
  items,
  kind,
  actor,
  actorName,
}: {
  items: ActivityFeedItem[];
  kind?: string;
  actor?: string;
  actorName: string | null;
}) {
  const active = ACTIVITY_KINDS.includes(kind as ActivityKind)
    ? (kind as ActivityKind)
    : "all";

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
          Журнал действий
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">
          Кто зашёл, что искал, какую карточку открыл и какую кнопку нажал.
          Последние 200 записей.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", ...ACTIVITY_KINDS] as const).map((value) => {
          const on = active === value;
          return (
            <Link
              key={value}
              className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium ${
                on
                  ? "bg-brand-blue text-white"
                  : "bg-white text-slate-700 ring-1 ring-slate-200"
              }`}
              href={hrefFor(value, actor)}
            >
              {KIND_LABEL[value]}
            </Link>
          );
        })}
      </div>

      {actor ? (
        <p className="text-sm text-slate-600">
          Только{" "}
          <span className="font-medium text-slate-900">
            {actorName ?? "этот пользователь"}
          </span>
          .{" "}
          <Link className="text-brand-blue underline" href={hrefFor(active)}>
            Показать всех
          </Link>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Пока нет таких записей. Заходы, поиск, открытие карточек и контактов
          уже пишутся. Нажатия кнопок — с этого обновления.
        </p>
      ) : (
        <ol className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((item) => (
            <li key={item.id} className="px-3 py-3 sm:px-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm text-slate-900">
                  {item.actorId ? (
                    <Link
                      className="font-semibold text-brand-blue hover:underline"
                      href={hrefFor(active, item.actorId)}
                    >
                      {item.actorName}
                    </Link>
                  ) : (
                    <span className="font-semibold">{item.actorName}</span>
                  )}{" "}
                  <span className="text-slate-500">· {item.action}</span>
                </p>
                <time
                  className="shrink-0 text-xs tabular-nums text-slate-400"
                  dateTime={item.at}
                >
                  {formatWhen(item.at)}
                </time>
              </div>
              <p className="mt-1 break-words text-sm text-slate-800">{item.detail}</p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-slate-400">
                {item.path}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
