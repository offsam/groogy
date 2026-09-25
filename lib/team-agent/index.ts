/**
 * Team Agent Foundation V1 — public module surface.
 */

export { loadTeamAgentConfig } from "./config";
export {
  CRITICAL_PATH_PATTERNS,
  detectPathConflicts,
  detectTaskScopeConflicts,
  isCriticalPath,
  normalizeScopePath,
  pathsOverlap,
} from "./conflicts";
export { shouldAgentRespond } from "./response-policy";
export { InMemoryTeamAgentStore } from "./store";
export {
  approveTask,
  assignTask,
  assertTaskTransition,
  blockTask,
  canTransitionTask,
  cancelTask,
  completeTask,
  isActiveTaskStatus,
  listActiveWorkload,
  markTaskForReview,
  proposeTask,
  startTask,
} from "./tasks";
export {
  confirmDecision,
  listAuthoritativeDecisions,
  proposeDecision,
  recordPotentialDecision,
  rejectDecision,
  supersedeDecision,
} from "./decisions";
export { recommendTaskDistribution } from "./distribution";
export {
  approvePendingAssignment,
  executeValidatedAction,
  isAllowedAction,
  isForbiddenAction,
  validateAgentAction,
} from "./actions";
export { ingestTeamMessage, resolveMemberFromExternalIdentity } from "./ingest";
export { buildTeamAgentContext } from "./context";
export {
  GitHubRepositoryContextProvider,
  LocalRepositoryContextProvider,
  MockRepositoryContextProvider,
} from "./repository-context";
export type { RepositoryContextProvider } from "./repository-context";
export { MockTeamAgentProvider } from "./agent-provider";
export type { TeamAgentProvider } from "./agent-provider";
export {
  invalidateMemory,
  listActiveMemory,
  recordMemory,
  supersedeMemory,
} from "./memory";
export {
  TEAM_MEMBER_BOOTSTRAP_TEMPLATE,
  seedMembersFromTemplate,
} from "./members";
export {
  archiveTopic,
  createTopic,
  findTopicBySlug,
  getTopicById,
  inferTopicIds,
  linkDecisionToTopic,
  linkInferredTopics,
  linkMemoryToTopic,
  linkMessageToTopics,
  linkTaskToTopic,
  listActiveTopics,
  mergeTopics,
  renameTopic,
  setTopicSummary,
} from "./topics";
export {
  DeterministicTopicClassifier,
  LLMTopicClassifier,
  resolveInvocationTopics,
} from "./topic-classifier";
export { normalizeTelegramUpdate } from "./telegram/normalize";
export { handleTelegramUpdate } from "./telegram/handle-update";
export type * from "./types";
