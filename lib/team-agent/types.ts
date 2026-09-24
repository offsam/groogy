/**
 * Team Agent Foundation V1 — shared domain types.
 * Internal developer tool only; not product messaging.
 */

export type TeamAgentSourceType = "telegram" | "manual" | "test";

export type TeamAgentMessageType = "text" | "system" | "bot" | "edited";

export type TeamAgentDecisionStatus =
  | "proposed"
  | "confirmed"
  | "rejected"
  | "superseded"
  | "cancelled";

export type TeamAgentTaskStatus =
  | "proposed"
  | "approved"
  | "in_progress"
  | "blocked"
  | "review"
  | "completed"
  | "cancelled";

export type TeamAgentTaskPriority = "low" | "normal" | "high" | "urgent";

export type TeamAgentMemoryType =
  | "project_fact"
  | "team_fact"
  | "decision"
  | "constraint"
  | "preference"
  | "summary";

export type TeamAgentMemoryStatus = "active" | "superseded" | "invalid";

export type TeamAgentGitEventType =
  | "branch_created"
  | "commit_pushed"
  | "pr_opened"
  | "pr_updated"
  | "merged";

export type TeamAgentApprovalType =
  | "task_assignment"
  | "task_batch"
  | "decision_confirm"
  | "memory_confirm";

export type TeamAgentApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export type ConflictSeverity = "none" | "possible" | "high";

export type TeamAgentMember = {
  id: string;
  display_name: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  github_username: string | null;
  role_title: string | null;
  responsibilities: string[];
  skills: string[];
  working_preferences: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TeamAgentConversation = {
  id: string;
  source_type: TeamAgentSourceType;
  external_conversation_id: string | null;
  title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TeamAgentMessage = {
  id: string;
  conversation_id: string;
  member_id: string | null;
  external_message_id: string | null;
  reply_to_message_id: string | null;
  message_type: TeamAgentMessageType;
  body: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
};

export type TeamAgentDecision = {
  id: string;
  title: string;
  description: string;
  status: TeamAgentDecisionStatus;
  source_message_id: string | null;
  decided_by: string | null;
  supersedes_decision_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamAgentTask = {
  id: string;
  title: string;
  description: string;
  status: TeamAgentTaskStatus;
  priority: TeamAgentTaskPriority;
  assigned_member_id: string | null;
  created_by_member_id: string | null;
  source_message_id: string | null;
  branch_name: string | null;
  scope_paths: string[];
  protected_paths: string[];
  excluded_paths: string[];
  acceptance_criteria: string[];
  dependency_task_ids: string[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamAgentGitActivity = {
  id: string;
  task_id: string | null;
  member_id: string | null;
  repository: string;
  branch_name: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  event_type: TeamAgentGitEventType;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TeamAgentMemory = {
  id: string;
  memory_type: TeamAgentMemoryType;
  subject: string;
  content: string;
  source_message_id: string | null;
  confidence: "low" | "medium" | "high";
  status: TeamAgentMemoryStatus;
  created_at: string;
  updated_at: string;
};

export type TeamAgentApproval = {
  id: string;
  approval_type: TeamAgentApprovalType;
  status: TeamAgentApprovalStatus;
  payload: Record<string, unknown>;
  proposed_by_member_id: string | null;
  decided_by_member_id: string | null;
  source_message_id: string | null;
  created_at: string;
  decided_at: string | null;
};

export type IngestTeamMessageInput = {
  source: TeamAgentSourceType;
  conversationExternalId: string | null;
  conversationTitle?: string;
  messageExternalId: string | null;
  senderExternalId: string | null;
  senderUsername: string | null;
  text: string;
  replyToExternalMessageId?: string | null;
  timestamp?: string;
  messageType?: TeamAgentMessageType;
  metadata?: Record<string, unknown>;
  /** Bot identity for mention detection — never hardcode in domain callers. */
  botUsername?: string | null;
  mentionTokens?: string[];
  explicitCommands?: string[];
};

export type IngestTeamMessageResult = {
  conversation: TeamAgentConversation;
  message: TeamAgentMessage;
  member: TeamAgentMember | null;
  unknownSender: boolean;
  duplicate: boolean;
  shouldRespond: boolean;
  respondReason: string | null;
};

export type PathConflict = {
  severity: ConflictSeverity;
  pathA: string;
  pathB: string;
  reason: string;
};

export type TaskConflictReport = {
  severity: ConflictSeverity;
  overlaps: PathConflict[];
};

export type DistributionRecommendation = {
  taskId: string;
  recommendedMemberId: string | null;
  reasons: string[];
  overlaps: PathConflict[];
  dependencyWarnings: string[];
  workloadWarning: string | null;
};

export type PotentialDecision = {
  title: string;
  description: string;
  sourceMessageIds: string[];
};

export type RepositoryContext = {
  provider: "local" | "mock" | "unavailable";
  repositoryName: string | null;
  currentBranch: string | null;
  recentCommits: Array<{ sha: string; message: string; date: string }>;
  gitStatus: string | null;
  changedFiles: string[];
  importantDirectories: string[];
  architectureDocPaths: string[];
  notes: string[];
};

export type TeamAgentContext = {
  requestingMember: TeamAgentMember | null;
  members: TeamAgentMember[];
  recentMessages: TeamAgentMessage[];
  activeDecisions: TeamAgentDecision[];
  activeTasks: TeamAgentTask[];
  blockedTasks: TeamAgentTask[];
  relevantMemory: TeamAgentMemory[];
  repository: RepositoryContext;
  potentialConflicts: PathConflict[];
  openQuestions: string[];
};

export const ACTIVE_TASK_STATUSES: readonly TeamAgentTaskStatus[] = [
  "proposed",
  "approved",
  "in_progress",
  "blocked",
  "review",
] as const;

export const AUTHORITATIVE_DECISION_STATUSES: readonly TeamAgentDecisionStatus[] =
  ["confirmed"] as const;

export const ALLOWED_AGENT_ACTIONS = [
  "create_task",
  "update_task",
  "assign_task",
  "record_decision",
  "supersede_decision",
  "record_memory",
  "request_repository_context",
  "check_conflicts",
  "propose_assignment_batch",
] as const;

export type AllowedAgentAction = (typeof ALLOWED_AGENT_ACTIONS)[number];

export const FORBIDDEN_AGENT_ACTIONS = [
  "merge",
  "deploy",
  "db_push",
  "delete_branch",
  "force_push",
  "execute_shell",
  "modify_production",
  "run_arbitrary_sql",
] as const;

export type ForbiddenAgentAction = (typeof FORBIDDEN_AGENT_ACTIONS)[number];

export type AgentActionProposal = {
  type: string;
  payload: Record<string, unknown>;
};

export type AgentRespondRequest = {
  triggerMessage: TeamAgentMessage;
  userText: string;
};

export type AgentRespondResult = {
  replyText: string;
  proposedActions: AgentActionProposal[];
  needsHumanApproval: boolean;
};
