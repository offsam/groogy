/**
 * Resolve the production Team Agent store for the Telegram webhook path.
 * Supabase-backed only — InMemory is for tests/simulator/bootstrap poller.
 */
import "server-only";

import { tryCreateServiceRoleClient } from "@/lib/supabase/service";
import type { TeamAgentStore } from "../store-port";
import { SupabaseTeamAgentStore } from "../supabase-store";

export function getTeamAgentProductionStore(): TeamAgentStore {
  const client = tryCreateServiceRoleClient();
  if (!client) {
    throw new Error(
      "Team Agent production store requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  return new SupabaseTeamAgentStore(client);
}
