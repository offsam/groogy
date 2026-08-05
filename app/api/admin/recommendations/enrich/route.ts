import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { enrichCommentRecommendationAction } from "@/lib/import-review/recommendation-actions";
import type { EnrichStreamEvent } from "@/lib/import-review/enrich-progress";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

type Body = { id?: string };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "Нужна авторизация" }, { status: 401 });
  }
  if (!(await userIsAdmin(supabase))) {
    return NextResponse.json({ message: "Только для админов" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ message: "Некорректный JSON" }, { status: 400 });
  }
  const id = (body.id || "").trim();
  if (!id || !isUuid(id)) {
    return NextResponse.json({ message: "Нужен id" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: EnrichStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        push({
          type: "started",
          label: "Обогащение карточки из очереди",
        });
        push({
          type: "step",
          id,
          step: "website",
          status: "running",
          detail: "Текст · сайт · фото · контакты",
        });

        const res = await enrichCommentRecommendationAction({ id });
        if (!res.ok) {
          push({ type: "error", message: res.message });
          controller.close();
          return;
        }

        for (const resource of res.resources) {
          push({
            type: "resource",
            url: resource.url,
            kind: resource.kind,
            status: resource.status,
            outcome: resource.outcome,
            fields: resource.fields,
            error: resource.error,
          });
        }

        push({
          type: "step",
          id,
          step: "website",
          status: "done",
          found: res.filled,
          detail: res.filled.length
            ? `Заполнено: ${res.filled.join(", ")}`
            : res.message,
        });
        push({
          type: "step",
          id,
          step: "cleanup",
          status: "done",
          found: res.filled,
          detail: res.message,
        });
        push({
          type: "finished",
          result: {
            id,
            skipped: res.filled.length === 0,
            reason: res.filled.length === 0 ? res.message : null,
            patch: res.filled.length
              ? Object.fromEntries(res.filled.map((k) => [k, true]))
              : {},
            resources: res.resources,
          },
        });

        revalidatePath("/admin/review");
        revalidatePath(
          `/admin/review/${encodeURIComponent(`recommendation:${id}`)}`,
        );
        revalidatePath("/admin/community/recommendations");
      } catch (err) {
        push({
          type: "error",
          message: err instanceof Error ? err.message : "Не удалось обогатить",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
