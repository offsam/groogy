/** Shared path lists for repository context. Not a live git snapshot. */

export const IMPORTANT_REPOSITORY_PATHS = {
  directories: [
    "app",
    "lib",
    "components",
    "supabase/migrations",
    "docs/architecture",
    "docs/navigation",
    "docs/team-agent",
    "scripts",
    "types",
  ],
  docs: [
    "docs/navigation/AI_AGENT_START_HERE.md",
    "docs/context/PROJECT_CONTEXT_V1.md",
    "docs/architecture/domain/CORE_DOMAIN_ARCHITECTURE_V1.md",
    "docs/architecture/runtime/PLATFORM_LIFECYCLE_V1.md",
    "docs/architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md",
    "docs/team-agent/TEAM_AGENT_ARCHITECTURE_V1.md",
  ],
} as const;
