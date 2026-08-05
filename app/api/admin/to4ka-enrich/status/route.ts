import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENRICH_DIR = path.join(
  process.cwd(),
  "scripts/business-enrich/data/to4ka_enrich",
);
const CHECKPOINT = path.join(ENRICH_DIR, "checkpoint.json");
const RUN_LOG = path.join(ENRICH_DIR, "run.log");

/** If no checkpoint update within this window, treat as stalled (not live). */
const STALE_MS = 12 * 60 * 1000;

type Checkpoint = {
  done_ids?: string[];
  errors?: Array<{ id?: string; error?: string }>;
  started_at?: string;
  updated_at?: string;
  finished_at?: string | null;
  stats?: {
    applied?: number;
    skipped?: number;
    failed?: number;
    todo_index?: number;
    todo_total?: number;
    elapsed_s?: number;
  };
};

function parseLastFromLog(logText: string): {
  lastName: string | null;
  lastProgressLine: string | null;
} {
  const lines = logText.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.includes("DONE ")) {
      return { lastName: null, lastProgressLine: line };
    }
    const m = /last=(.+)$/.exec(line);
    if (m) {
      return { lastName: m[1].trim(), lastProgressLine: line };
    }
  }
  return { lastName: null, lastProgressLine: lines.at(-1) ?? null };
}

export async function GET() {
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

  let checkpoint: Checkpoint | null = null;
  let logTail: string[] = [];
  let lastName: string | null = null;
  let lastProgressLine: string | null = null;

  try {
    const raw = await fs.readFile(CHECKPOINT, "utf8");
    checkpoint = JSON.parse(raw) as Checkpoint;
  } catch {
    checkpoint = null;
  }

  try {
    const logText = await fs.readFile(RUN_LOG, "utf8");
    const parsed = parseLastFromLog(logText);
    lastName = parsed.lastName;
    lastProgressLine = parsed.lastProgressLine;
    logTail = logText
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-12)
      .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z\s*/, ""));
  } catch {
    // no log yet
  }

  if (!checkpoint) {
    return NextResponse.json({
      ok: true,
      status: "idle",
      message: "Нет активного или сохранённого прогона обогащения to4ka.",
      done: 0,
      total: 0,
      applied: 0,
      skipped: 0,
      failed: 0,
      percent: 0,
      lastName: null,
      recent: [],
      errors: [],
      logTail: [],
      startedAt: null,
      updatedAt: null,
      finishedAt: null,
    });
  }

  const stats = checkpoint.stats || {};
  const doneIds = checkpoint.done_ids || [];
  const done =
    typeof stats.todo_index === "number" ? stats.todo_index : doneIds.length;
  const total =
    typeof stats.todo_total === "number" ? stats.todo_total : doneIds.length;
  const applied = stats.applied ?? done;
  const skipped = stats.skipped ?? 0;
  const failed = stats.failed ?? (checkpoint.errors?.length ?? 0);
  const percent =
    total > 0 ? Math.min(100, Math.round((done / total) * 1000) / 10) : 0;

  const updatedAt = checkpoint.updated_at || null;
  const finishedAt = checkpoint.finished_at || null;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : 0;
  const ageMs = updatedMs ? Date.now() - updatedMs : Number.POSITIVE_INFINITY;

  let status: "running" | "finished" | "stalled" | "idle" = "idle";
  if (finishedAt || (lastProgressLine && lastProgressLine.includes("DONE "))) {
    status = "finished";
  } else if (done > 0 || total > 0) {
    status = ageMs <= STALE_MS ? "running" : "stalled";
  }

  const recentIds = doneIds.slice(-8).reverse();
  const recent: Array<{ id: string; name: string; href: string | null }> = [];

  if (recentIds.length) {
    try {
      const catalog = createServiceRoleClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (catalog as any)
        .from("businesses")
        .select("id, name, slug")
        .in("id", recentIds);
      const byId = new Map<
        string,
        { id: string; name: string | null; slug: string | null }
      >();
      for (const row of (data ?? []) as Array<{
        id: string;
        name: string | null;
        slug: string | null;
      }>) {
        byId.set(row.id, row);
      }
      for (const id of recentIds) {
        const row = byId.get(id);
        recent.push({
          id,
          name: row?.name?.trim() || id.slice(0, 8),
          href: row?.slug ? `/business/${row.slug}` : null,
        });
      }
    } catch {
      for (const id of recentIds) {
        recent.push({ id, name: id.slice(0, 8), href: null });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    status,
    message:
      status === "running"
        ? "Обогащение to4ka идёт"
        : status === "finished"
          ? "Прогон обогащения to4ka завершён"
          : status === "stalled"
            ? "Прогон похоже остановился (давно не было обновлений)"
            : "Нет активного прогона",
    done,
    total,
    remaining: Math.max(0, total - done),
    applied,
    skipped,
    failed,
    percent,
    lastName,
    lastProgressLine,
    elapsedS: stats.elapsed_s ?? null,
    recent,
    errors: (checkpoint.errors || []).slice(-12).reverse(),
    logTail,
    startedAt: checkpoint.started_at || null,
    updatedAt,
    finishedAt,
  });
}
