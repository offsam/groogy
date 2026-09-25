/**
 * Normalized project observation. Task status and delivery status stay separate.
 */

export type ConnectionStatus =
  | "connected"
  | "not_configured"
  | "authorization_failed"
  | "temporarily_unavailable"
  | "syncing"
  | "stale"
  | "not_implemented";

export type DeliveryStage =
  | "not_started"
  | "local_work"
  | "committed"
  | "pushed"
  | "pr_open"
  | "checks_passed"
  | "preview_ready"
  | "merged"
  | "production_deployed";

export type LocalVisibility = "unknown" | "stale" | "dirty" | "clean";

export type CheckState = "success" | "failure" | "pending" | "unknown";

export type DeploymentStatus =
  | "READY"
  | "BUILDING"
  | "ERROR"
  | "CANCELED"
  | "QUEUED"
  | "UNKNOWN";

export type ConnectionRecord = {
  provider: "github" | "vercel" | "supabase" | "cursor" | "ci" | "openrouter" | "telegram";
  status: ConnectionStatus;
  lastSuccessfulSync: string | null;
  lastAttemptedSync: string | null;
  lastError: string | null;
  permissions: string;
  resources: string[];
  fresh: boolean;
};

export type GithubBranchState = {
  name: string;
  sha: string;
  ahead: number | null;
  behind: number | null;
  updatedAt: string | null;
  author: string | null;
};

export type PullRequestState = {
  number: number;
  title: string;
  author: string | null;
  headRef: string;
  headSha: string;
  baseRef: string;
  draft: boolean;
  mergeable: boolean | null;
  merged: boolean;
  mergedAt: string | null;
  files: string[];
  checks: CheckState;
  url: string;
  updatedAt: string | null;
};

export type DeploymentState = {
  id: string;
  environment: "production" | "preview";
  status: DeploymentStatus;
  url: string | null;
  branch: string | null;
  sha: string | null;
  createdAt: string | null;
  readyAt: string | null;
  error: string | null;
};

export type LocalWorkReport = {
  taskId: string | null;
  memberId: string;
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  dirty: boolean;
  changedPaths: string[];
  reportedAt: string;
};

export type MigrationView = {
  status: ConnectionStatus;
  checkedAt: string | null;
  localFiles: string[];
  applied: string[];
  pending: string[];
  unknownRemote: string[];
  repairFiles: string[];
  error: string | null;
};

export type TaskInput = {
  id: string;
  title: string;
  status: string;
  branchName: string | null;
  assignedMemberId: string | null;
  scopePaths: string[];
};

export type MemberInput = {
  id: string;
  displayName: string;
};

export type SourceState<T> = {
  status: ConnectionStatus;
  checkedAt: string | null;
  error: string | null;
  value: T;
};

export type ObservedInputs = {
  now: string;
  staleAfterMs: number;
  github: SourceState<{
    repo: string | null;
    defaultBranch: string | null;
    mainSha: string | null;
    branches: GithubBranchState[];
    pulls: PullRequestState[];
  }>;
  vercel: SourceState<{
    production: DeploymentState | null;
    previews: DeploymentState[];
  }>;
  supabase: MigrationView;
  localReports: LocalWorkReport[];
  openrouter: SourceState<{ model: string | null }>;
  telegram: SourceState<{ webhookUrl: string | null }>;
  tasks: TaskInput[];
  members: MemberInput[];
};

export type ProjectIssue = {
  key: string;
  severity: "info" | "warning" | "blocking";
  source: string;
  component: string;
  evidence: string;
  detectedAt: string;
  lastSeenAt: string;
  status: "open" | "resolved";
  nextAction: string;
};

export type TaskProgress = {
  taskId: string;
  title: string;
  taskStatus: string;
  assignee: string | null;
  branch: string | null;
  sha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  checks: "success" | "failure" | "pending" | "unknown" | null;
  delivery: DeliveryStage;
  local: LocalVisibility;
  previewUrl: string | null;
  previewStatus: DeploymentStatus | null;
  productionMatches: boolean | null;
  evidence: string;
  checkedAt: string;
  paths: string[];
};

export type ProjectSnapshot = {
  takenAt: string;
  connections: ConnectionRecord[];
  tasks: TaskProgress[];
  issues: ProjectIssue[];
  conflicts: string[];
  githubRepo: string | null;
  branches: GithubBranchState[];
  mainSha: string | null;
  defaultBranch: string | null;
  productionSha: string | null;
  productionStatus: DeploymentStatus | null;
  productionUrl: string | null;
};
