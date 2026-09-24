/**
 * Compact TeamAgentContext builder — bounded history, authoritative decisions only.
 */

import { loadTeamAgentConfig } from "./config";
import { detectPathConflicts } from "./conflicts";
import { listAuthoritativeDecisions } from "./decisions";
import type { RepositoryContextProvider } from "./repository-context";
import { MockRepositoryContextProvider } from "./repository-context";
import type { TeamAgentStore } from "./store-port";
import { isActiveTaskStatus } from "./tasks";
import type {
  PathConflict,
  TeamAgentContext,
  TeamAgentMember,
  TeamAgentMessage,
} from "./types";

export type BuildContextOptions = {
  conversationId: string;
  requestingMember?: TeamAgentMember | null;
  triggerMessage?: TeamAgentMessage | null;
  repositoryProvider?: RepositoryContextProvider;
  maxMessages?: number;
};

export async function buildTeamAgentContext(
  store: TeamAgentStore,
  opts: BuildContextOptions,
): Promise<TeamAgentContext> {
  const config = loadTeamAgentConfig();
  const maxMessages = opts.maxMessages ?? config.maxContextMessages;
  const repoProvider =
    opts.repositoryProvider ?? new MockRepositoryContextProvider();

  const members = await store.listActiveMembers();
  const recentMessages = await store.listRecentMessages(
    opts.conversationId,
    maxMessages,
  );

  const activeDecisions = await listAuthoritativeDecisions(store);
  const allTasks = await store.listTasks();
  const allActiveTasks = allTasks.filter((t) => isActiveTaskStatus(t.status));
  const blockedTasks = allActiveTasks.filter((t) => t.status === "blocked");

  const memory = await store.listMemory();
  const relevantMemory = memory.filter((m) => m.status === "active").slice(-20);

  const potentialConflicts: PathConflict[] = [];
  for (let i = 0; i < allActiveTasks.length; i++) {
    for (let j = i + 1; j < allActiveTasks.length; j++) {
      const report = detectPathConflicts(
        allActiveTasks[i].scope_paths,
        allActiveTasks[j].scope_paths,
      );
      potentialConflicts.push(...report.overlaps);
    }
  }

  const openQuestions = recentMessages
    .filter((m) => m.body.includes("?"))
    .map((m) => m.body.slice(0, 200))
    .slice(-10);

  return {
    requestingMember: opts.requestingMember ?? null,
    members,
    recentMessages,
    activeDecisions,
    activeTasks: allActiveTasks,
    blockedTasks,
    relevantMemory,
    repository: repoProvider.getContext(),
    potentialConflicts,
    openQuestions,
  };
}
