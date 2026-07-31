import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventProfileView } from "@/components/events/EventProfileView";
import { getPublishedEventBySlug } from "@/lib/events/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ claim?: string }>;
};

function normalizeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw).normalize("NFC");
  } catch {
    return raw.normalize("NFC");
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: raw } = await params;
  const slug = normalizeSlug(raw);
  try {
    const client = createServiceRoleClient();
    const event = await getPublishedEventBySlug(client, slug);
    if (!event) return { title: "Событие — КРУГИ" };
    return {
      title: `${event.title} — КРУГИ`,
      description:
        (event.source_body || event.description)?.slice(0, 160) ||
        "Событие сообщества",
    };
  } catch {
    return { title: "Событие — КРУГИ" };
  }
}

export default async function EventDetailPage({ params, searchParams }: PageProps) {
  const { slug: raw } = await params;
  const { claim } = await searchParams;
  const slug = normalizeSlug(raw);

  let event = null;
  let loadError: string | null = null;
  let isAdmin = false;
  let isOwner = false;
  let userId: string | null = null;
  try {
    const client = createServiceRoleClient();
    event = await getPublishedEventBySlug(client, slug);
    const session = await createServerClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    userId = user?.id ?? null;
    if (user) {
      isAdmin = await userIsAdmin(session).catch(() => false);
      if (event) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (client as any)
          .from("events")
          .select("owner_profile_id")
          .eq("id", event.id)
          .maybeSingle();
        isOwner = Boolean(
          data?.owner_profile_id && data.owner_profile_id === user.id,
        );
      }
    }
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить событие";
  }
  if (!event) {
    if (loadError) {
      return (
        <div className="mx-auto max-w-2xl px-3 py-10 text-sm text-red-700">
          Ошибка загрузки события: {loadError}
        </div>
      );
    }
    notFound();
  }

  return (
    <EventProfileView
      autoClaim={claim === "1" && Boolean(userId) && !isOwner && !isAdmin}
      event={event}
      isAdmin={isAdmin}
      isOwner={isOwner || isAdmin}
    />
  );
}
