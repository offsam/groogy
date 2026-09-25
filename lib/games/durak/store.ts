import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyDurakAction,
  emptyState,
  presentDurak,
  type DurakAction,
  type DurakState,
  type DurakView,
} from "@/lib/games/durak/engine";
import { createServerClient } from "@/lib/supabase/server";
import { tryCreateServiceRoleClient } from "@/lib/supabase/service";

export const DURAK_TABLE_IDS = [1, 2, 3] as const;
export type DurakTableId = (typeof DURAK_TABLE_IDS)[number];

export function parseDurakTableId(value: unknown): DurakTableId | null {
  const id = typeof value === "number" ? value : Number(value);
  if (id === 1 || id === 2 || id === 3) return id;
  return null;
}

type DurakRow = {
  id: number;
  state: DurakState;
  updated_at: string;
};

function db(client: SupabaseClient) {
  return client as unknown as {
    from: (table: "durak_tables") => {
      select: (cols: string) => {
        eq: (
          col: "id",
          value: number,
        ) => {
          maybeSingle: () => Promise<{
            data: DurakRow | null;
            error: { message: string } | null;
          }>;
        };
      };
      insert: (row: DurakRow) => Promise<{ error: { message: string } | null }>;
      update: (row: { state: DurakState; updated_at: string }) => {
        eq: (
          col: "id",
          value: number,
        ) => {
          eq: (
            col: "updated_at",
            value: string,
          ) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: DurakRow | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  };
}

function isState(value: unknown): value is DurakState {
  if (!value || typeof value !== "object") return false;
  const seats = (value as DurakState).seats;
  return Array.isArray(seats) && seats.length === 7 && "phase" in value;
}

async function viewer(): Promise<{ id: string; name: string } | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .maybeSingle();
  const name = data?.display_name?.trim() || data?.username?.trim() || "Игрок";
  return { id: user.id, name };
}

async function readRow(
  client: SupabaseClient,
  tableId: DurakTableId,
): Promise<{ state: DurakState; updatedAt: string } | { error: string }> {
  const table = db(client).from("durak_tables");
  const { data, error } = await table
    .select("id, state, updated_at")
    .eq("id", tableId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) {
    const state = emptyState();
    const updatedAt = new Date().toISOString();
    const inserted = await table.insert({
      id: tableId,
      state,
      updated_at: updatedAt,
    });
    if (inserted.error) return { error: inserted.error.message };
    return { state, updatedAt };
  }
  return {
    state: isState(data.state) ? data.state : emptyState(),
    updatedAt: data.updated_at,
  };
}

async function writeRow(
  client: SupabaseClient,
  tableId: DurakTableId,
  state: DurakState,
  previousUpdatedAt: string,
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await db(client)
    .from("durak_tables")
    .update({ state, updated_at: updatedAt })
    .eq("id", tableId)
    .eq("updated_at", previousUpdatedAt)
    .select("id, state, updated_at")
    .maybeSingle();
  return !error && Boolean(data);
}

function offlineView(
  you: { id: string; name: string } | null,
  notice: string | null,
): DurakView {
  return presentDurak(emptyState(), you, { connected: false, notice });
}

export type DurakTableSummary = {
  id: DurakTableId;
  seated: number;
};

export async function listDurakTables(): Promise<DurakTableSummary[]> {
  const client = tryCreateServiceRoleClient();
  const summaries: DurakTableSummary[] = [];
  for (const id of DURAK_TABLE_IDS) {
    if (!client) {
      summaries.push({ id, seated: 0 });
      continue;
    }
    const row = await readRow(client, id);
    summaries.push({
      id,
      seated:
        "error" in row
          ? 0
          : row.state.seats.filter((seat) => seat.userId || seat.isBot).length,
    });
  }
  return summaries;
}

export async function loadDurakView(tableId: DurakTableId): Promise<DurakView> {
  const you = await viewer();
  const client = tryCreateServiceRoleClient();
  if (!client) {
    return offlineView(
      you,
      "Стол виден, но места пока не сохраняются: нет серверного ключа базы.",
    );
  }
  const row = await readRow(client, tableId);
  if ("error" in row) {
    return offlineView(
      you,
      "Стол ещё не создан в базе. После миграции места начнут сохраняться.",
    );
  }
  return presentDurak(row.state, you, { connected: true, notice: null });
}

export async function mutateDurak(
  tableId: DurakTableId,
  action: DurakAction,
): Promise<{ view: DurakView; message: string | null }> {
  const you = await viewer();
  if (!you) {
    return {
      view: offlineView(null, null),
      message: "Чтобы сесть, войдите или зарегистрируйтесь.",
    };
  }
  const client = tryCreateServiceRoleClient();
  if (!client) {
    return {
      view: offlineView(you, "Нет серверного ключа базы."),
      message: "Сейчас нельзя занять место.",
    };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readRow(client, tableId);
    if ("error" in row) {
      return {
        view: offlineView(you, row.error),
        message: "Стол ещё не готов. Нужна миграция базы.",
      };
    }
    let next: DurakState;
    try {
      next = applyDurakAction(row.state, action);
    } catch (err) {
      return {
        view: presentDurak(row.state, you),
        message: err instanceof Error ? err.message : "Ход не принят.",
      };
    }
    const saved = await writeRow(client, tableId, next, row.updatedAt);
    if (saved) return { view: presentDurak(next, you), message: null };
  }
  return {
    view: await loadDurakView(tableId),
    message: "Стол только что изменился. Повторите ход.",
  };
}
