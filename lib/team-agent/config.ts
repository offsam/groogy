/**
 * Team Agent runtime configuration (env names only — no secrets required for V1).
 */

export type TeamAgentConfig = {
  enabled: boolean;
  botUsername: string | null;
  allowedChatId: string | null;
  provider: "mock" | "openai" | "openrouter";
  mentionTokens: string[];
  explicitCommands: string[];
  maxContextMessages: number;
  maxTopicCandidates: number;
  maxSelectedTopics: number;
  maxOverviewTopics: number;
  maxContextChars: number;
  maxOutputTokens: number;
  model: string;
  requireWebhookSecret: boolean;
};

/** Explicit invocation commands only — never bare words like «агент». */
const DEFAULT_COMMANDS = ["/agent", "/team_agent", "/team-agent"] as const;

export function loadTeamAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): TeamAgentConfig {
  const botUsername =
    (env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "") || null;
  const mentionTokens = botUsername ? [`@${botUsername.toLowerCase()}`] : [];

  return {
    enabled: env.TEAM_AGENT_ENABLED === "1" || env.TEAM_AGENT_ENABLED === "true",
    botUsername,
    allowedChatId: (env.TELEGRAM_ALLOWED_CHAT_ID ?? "").trim() || null,
    provider: normalizeProvider(env.TEAM_AGENT_PROVIDER),
    mentionTokens,
    explicitCommands: [...DEFAULT_COMMANDS],
    maxContextMessages: 30,
    maxTopicCandidates: positiveInt(env.TEAM_AGENT_MAX_TOPIC_CANDIDATES, 20),
    maxSelectedTopics: positiveInt(env.TEAM_AGENT_MAX_SELECTED_TOPICS, 3),
    maxOverviewTopics: positiveInt(env.TEAM_AGENT_MAX_OVERVIEW_TOPICS, 5),
    maxContextChars: positiveInt(env.TEAM_AGENT_MAX_CONTEXT_CHARS, 40_000),
    maxOutputTokens: positiveInt(env.TEAM_AGENT_MAX_OUTPUT_TOKENS, 1200),
    model: resolveModel(env),
    requireWebhookSecret: true,
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/** Chosen after the OpenRouter catalog check. Env overrides it. */
const OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

function resolveModel(env: NodeJS.ProcessEnv): string {
  const explicit = (env.TEAM_AGENT_MODEL ?? "").trim().replace(/^=+/, "");
  if (explicit) return explicit;
  if (normalizeProvider(env.TEAM_AGENT_PROVIDER) === "openrouter") {
    return OPENROUTER_DEFAULT_MODEL;
  }
  return "gpt-6-luna";
}

function normalizeProvider(
  value: string | undefined,
): TeamAgentConfig["provider"] {
  const v = (value ?? "mock").trim().toLowerCase();
  if (v === "openai" || v === "openrouter") return v;
  return "mock";
}

export function resolveTeamAgentPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = (env.TEAM_AGENT_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const site = (env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  if (site) return site;
  return null;
}
