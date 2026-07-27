import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TelegramSourcePanel } from "@/components/admin/TelegramSourcePanel";
import {
  telegramSourceBySlug,
  TELEGRAM_SOURCE_LIST,
} from "@/lib/import-review/telegram-sources";
import { listCommentRecommendations } from "@/lib/import-review/recommendation-queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ source: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ source: string }>;
}): Promise<Metadata> {
  const { source: slug } = await params;
  const meta = telegramSourceBySlug(slug);
  return {
    title: meta ? `${meta.title} — Admin` : "Telegram — Admin",
  };
}

export default async function AdminTelegramSourcePage({
  params,
  searchParams,
}: PageProps) {
  const { source: slug } = await params;
  const source = telegramSourceBySlug(slug);
  if (!source) notFound();

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/admin/telegram-groups/${slug}`);
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const q = await searchParams;
  const status = q.status || "pending";
  const page = Math.max(1, Number(q.page || "1") || 1);
  const entityRaw = q.entity || "all";
  const entity =
    entityRaw === "professional" ||
    entityRaw === "business" ||
    entityRaw === "service"
      ? entityRaw
      : "all";
  const category = q.category || "all";

  let items: Awaited<ReturnType<typeof listCommentRecommendations>>["items"] =
    [];
  let total = 0;
  let loadError: string | null = null;

  try {
    const listed = await listCommentRecommendations(supabase, {
      status,
      kind: "profi",
      sourceChannel: "telegram",
      directorySource: source.id,
      excludeBuckets: ["yellow_pages"],
      page,
      pageSize: 200,
    });
    items = listed.items;
    total = listed.total;
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;
    loadError =
      message?.trim() ||
      `Не удалось загрузить карточки ${source.shortTitle}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue">Импорт · Telegram</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          {source.title}
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">{source.description}</p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/telegram-groups"
            className="text-brand-blue hover:underline"
          >
            ← Все Telegram-группы
          </Link>
          {source.username ? (
            <a
              href={source.homepage}
              target="_blank"
              rel="noreferrer"
              className="text-brand-blue hover:underline"
            >
              @{source.username} →
            </a>
          ) : null}
          <Link href="/admin" className="text-brand-blue hover:underline">
            Админ-панель
          </Link>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {TELEGRAM_SOURCE_LIST.map((s) => (
            <Link
              key={s.id}
              href={`/admin/telegram-groups/${s.slug}`}
              className={
                s.id === source.id
                  ? "rounded-md bg-brand-blue px-2.5 py-1 text-xs font-semibold text-white"
                  : "rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              }
            >
              {s.shortTitle}
            </Link>
          ))}
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <TelegramSourcePanel
          category={category}
          entity={entity}
          source={source}
          items={items}
          total={total}
          status={status}
        />
      )}
    </div>
  );
}
