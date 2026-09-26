/**
 * OpenAI Responses provider. One respond() = one model request
 * (one extra HTTP try only for 429 / 5xx).
 */

import OpenAI from "openai";
import { isAllowedAction, isForbiddenAction, validateAgentAction } from "./actions";
import { loadTeamAgentConfig } from "./config";
import { KROOGY_PROJECT_BRIEF } from "./project-brief";
import { isGlobalConstraint } from "./topics";
import type { TeamAgentProvider } from "./agent-provider";
import {
  TEAM_AGENT_SYSTEM_PROMPT_V1,
  TEAM_AGENT_SYSTEM_PROMPT_VERSION,
} from "./prompts/team-agent-system-v1";
import {
  ACTIVE_TASK_STATUSES,
  type AgentActionProposal,
  type AgentRespondRequest,
  type AgentRespondResult,
  type TeamAgentContext,
  type TeamAgentMemoryType,
} from "./types";

export const PUBLIC_AI_FAILURE_TEXT = "Не удалось получить ответ AI. Попробуйте ещё раз.";

export function publicFailureText(code: string): string {
  if (code === "billing_credits") {
    return "Недостаточно средств на OpenRouter. Нужно пополнить баланс.";
  }
  if (code === "billing_key_limit") {
    return "Достигнут лимит API-ключа OpenRouter.";
  }
  if (code === "billing_inflight") {
    return "OpenRouter временно ограничил траты этого ключа. Повторите позже.";
  }
  if (code === "billing_unknown") {
    return "OpenRouter отклонил запрос по биллингу. Проверьте баланс и лимит ключа.";
  }
  if (code === "timeout") {
    return "OpenRouter не ответил вовремя. Повторите вопрос один раз.";
  }
  if (code === "rate_limited") {
    return "OpenRouter ограничил частоту запросов. Подождите минуту и повторите.";
  }
  if (code === "upstream") {
    return "OpenRouter временно недоступен. Повторите позже.";
  }
  if (code === "malformed" || code === "empty") {
    return "Ответ модели пришёл в неверном виде. Повторите вопрос.";
  }
  return PUBLIC_AI_FAILURE_TEXT;
}

/** Pull a JSON object out of a model reply. Fences and a short preface are ignored. */
export function extractModelJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  if (body.startsWith("{")) return body;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}

/** OpenRouter 402 is not one reason. Do not retry, and do not assume the wallet is empty. */
export function classifyBillingFailure(
  status: number,
  message: string,
): TeamAgentModelErrorCode | null {
  if (status !== 402) return null;
  const text = message.toLowerCase();
  if (
    text.includes("key limit") ||
    text.includes("monthly limit") ||
    text.includes("spending limit") ||
    text.includes("limit exceeded")
  ) {
    return "billing_key_limit";
  }
  if (text.includes("in-flight") || text.includes("inflight")) {
    return "billing_inflight";
  }
  if (
    text.includes("credit") ||
    text.includes("insufficient") ||
    text.includes("balance") ||
    text.includes("afford")
  ) {
    return "billing_credits";
  }
  return "billing_unknown";
}

const REPLY_CAP = 8000;

const MEMORY_TYPES = new Set<TeamAgentMemoryType>([
  "project_fact",
  "team_fact",
  "decision",
  "constraint",
  "preference",
  "summary",
]);

export const TEAM_AGENT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply",
    "topicIds",
    "proposedActions",
    "memoryProposals",
    "topicSummaryUpdates",
  ],
  properties: {
    reply: { type: "string" },
    topicIds: { type: "array", items: { type: "string" } },
    proposedActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "payloadJson"],
        properties: {
          type: { type: "string" },
          payloadJson: { type: "string" },
        },
      },
    },
    memoryProposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["memory_type", "subject", "content"],
        properties: {
          memory_type: { type: "string" },
          subject: { type: "string" },
          content: { type: "string" },
        },
      },
    },
    topicSummaryUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topicId", "summary"],
        properties: {
          topicId: { type: "string" },
          summary: { type: "string" },
        },
      },
    },
  },
} as const;

export type TeamAgentModelRequest = {
  model: string;
  instructions: string;
  input: string;
  max_output_tokens: number;
  reasoning: { effort: "low" };
  store: false;
  text: {
    format: {
      type: "json_schema";
      name: "team_agent_turn_v1";
      strict: true;
      schema: typeof TEAM_AGENT_RESPONSE_SCHEMA;
    };
  };
};

export type TeamAgentModelResponse = {
  id?: string;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
};

export type TeamAgentModelCaller = (
  request: TeamAgentModelRequest,
) => Promise<TeamAgentModelResponse>;

export type TeamAgentModelErrorCode =
  | "invalid_api_key"
  | "timeout"
  | "rate_limited"
  | "upstream"
  | "malformed"
  | "empty"
  | "not_configured"
  | "request_failed"
  | "billing_credits"
  | "billing_key_limit"
  | "billing_inflight"
  | "billing_unknown";

export type ProviderCallStage =
  | "before_http"
  | "connect"
  | "await_response"
  | "http_response"
  | "parse"
  | "after_model"
  | "persist"
  | "telegram_send";

export type ProviderFailureLog = {
  exception_name: string | null;
  exception_message: string | null;
  cause_name: string | null;
  cause_message: string | null;
  http_status: number | null;
  stage: string;
  provider_request_id: string | null;
  provider_response_id: string | null;
};

const PROVIDER_STAGE_KEY = "teamAgentProviderStage";
const PROVIDER_RESPONSE_KEY = "teamAgentProviderResponseId";
const ID_RE = /^(?:req|gen)-[A-Za-z0-9_-]{6,}$/;

export class TeamAgentModelError extends Error {
  readonly code: TeamAgentModelErrorCode;
  readonly origin: unknown;
  readonly providerStage: string | null;
  readonly httpStatus: number | null;
  readonly providerRequestId: string | null;
  readonly providerResponseId: string | null;

  constructor(code: TeamAgentModelErrorCode, detail?: { cause?: unknown; stage?: string; responseId?: string | null }) {
    const cause = detail?.cause;
    super(code, cause instanceof Error ? { cause } : undefined);
    this.name = "TeamAgentModelError";
    this.code = code;
    this.origin = cause ?? null;
    const tagged = readProviderTag(cause);
    const ids = providerIdsOf(cause);
    this.providerStage = detail?.stage ?? tagged.stage;
    this.httpStatus = httpStatusOf(cause);
    this.providerRequestId = ids.requestId;
    this.providerResponseId = detail?.responseId ?? tagged.responseId ?? ids.responseId;
  }
}

function redactSecrets(text: string): string {
  return text
    .replace(
      /(?:OPENAI_API_KEY|OPENROUTER_API_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|GITHUB_TEAM_AGENT_TOKEN|GITHUB_TEAM_AGENT_WEBHOOK_SECRET|VERCEL_TEAM_AGENT_TOKEN|SUPABASE_ACCESS_TOKEN|TEAM_AGENT_REPORTER_TOKEN|TEAM_AGENT_RECONCILE_SECRET)\s*[:=]\s*\S+/gi,
      "[redacted]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bghp_[A-Za-z0-9_]+\b/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[redacted]");
}

function clip(text: string, max: number): string {
  const clean = redactSecrets(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

export function buildTeamAgentModelInput(
  context: TeamAgentContext,
  request: AgentRespondRequest,
  maxChars: number,
): { text: string; allowedTopicIds: string[] } {
  const allowedTopicIds = context.topics.map((t) => t.id);
  const allowed = new Set(allowedTopicIds);

  const constraints = context.relevantMemory.filter(isGlobalConstraint);
  const otherMemory = context.relevantMemory.filter(
    (m) => m.status === "active" && !isGlobalConstraint(m),
  );
  const decisions = context.activeDecisions.filter((d) => d.status === "confirmed");
  const tasks = context.activeTasks.filter((t) =>
    (ACTIVE_TASK_STATUSES as readonly string[]).includes(t.status),
  );

  const sections: Array<{ label: string; lines: string[] }> = [
    {
      label: "request",
      lines: [clip(request.userText, Math.max(500, maxChars))],
    },
    {
      label: "project",
      lines: [clip(KROOGY_PROJECT_BRIEF, 1200)],
    },
    {
      label: "members",
      lines: context.members.map((m) => {
        const role = m.role_title ? ` (${m.role_title})` : "";
        const duty = m.responsibilities.length
          ? `: ${m.responsibilities.join(", ")}`
          : "";
        const telegramId = m.telegram_user_id ?? "нет в базе";
        return `${m.display_name}${role} telegram_id=${telegramId}${duty}`;
      }),
    },
    {
      label: "speaker",
      lines: [
        context.requestingMember
          ? `${context.requestingMember.display_name} telegram_id=${context.requestingMember.telegram_user_id ?? "нет в базе"}`
          : "отправитель не сопоставлен с участником по telegram id",
      ],
    },
    {
      label: "TOPIC SUMMARY",
      lines: context.topics.map(
        (t) => `${t.id} | ${t.title} | ${t.status} | ${clip(t.summary, 500)}`,
      ),
    },
    {
      label: "constraints",
      lines: constraints.map((m) => `${m.subject}: ${clip(m.content, 400)}`),
    },
    {
      label: "MEMORY",
      lines: otherMemory.map((m) => `${m.memory_type}/${m.subject}: ${clip(m.content, 300)}`),
    },
    {
      label: "DECISION",
      lines: decisions.map((d) => `${d.title}: ${clip(d.description, 400)}`),
    },
    {
      label: "CONFIRMED TASK",
      lines: tasks.map((t) => {
        const member = context.members.find((item) => item.id === t.assigned_member_id);
        const who = member
          ? `${member.display_name} telegram_id=${member.telegram_user_id ?? "нет в базе"}`
          : "Не назначено";
        const scope = t.scope_paths.join(", ");
        return `${t.title} [${t.status}] assignee=${who} scope=${scope}`;
      }),
    },
    {
      label: "conflicts",
      lines: context.potentialConflicts.map(
        (c) => `${c.pathA} ∩ ${c.pathB} (${c.severity})`,
      ),
    },
    {
      label: "repository",
      lines: [
        `provider=${context.repository.provider}`,
        `branch=${context.repository.currentBranch ?? ""}`,
        ...context.repository.notes.slice(0, 8).map((note) => redactSecrets(note)),
        ...context.repository.changedFiles.slice(0, 20).map((f) => redactSecrets(f)),
      ],
    },
    {
      label: "PROJECT STATUS",
      lines: (context.projectLines ?? []).slice(0, 12).map((line) => redactSecrets(line)),
    },
    {
      label: "RECENT CHAT — UNCONFIRMED",
      lines: context.recentMessages
        .filter((m) => m.message_type !== "system" && m.external_message_id !== "project-status")
        .map((m) => clip(m.body, 500)),
    },
  ];

  const render = () =>
    sections
      .filter((s) => s.lines.length > 0)
      .map((s) => `# ${s.label}\n${s.lines.join("\n")}`)
      .join("\n\n");

  const shrink = [
    ["RECENT CHAT — UNCONFIRMED", 4],
    ["MEMORY", 0],
    ["project", 0],
    ["PROJECT STATUS", 0],
    ["RECENT CHAT — UNCONFIRMED", 0],
    ["TOPIC SUMMARY", 0],
  ] as const;
  for (const [label, floor] of shrink) {
    const section = sections.find((s) => s.label === label);
    if (!section) continue;
    while (render().length > maxChars && section.lines.length > floor) {
      section.lines.shift();
    }
  }

  let text = render();
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return { text, allowedTopicIds: [...allowed] };
}

function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const payload = { ...(value as Record<string, unknown>) };
    delete payload.autoConfirm;
    delete payload.status;
    return payload;
  } catch {
    return null;
  }
}

function acceptAction(type: string, payload: Record<string, unknown>): AgentActionProposal | null {
  if (isForbiddenAction(type) || !isAllowedAction(type)) return null;
  const proposal = { type, payload };
  const validated = validateAgentAction(proposal);
  if (!validated.ok) return null;
  return proposal;
}

export function parseTeamAgentModelOutput(
  raw: string,
  allowedTopicIds: string[],
): Omit<AgentRespondResult, "provider" | "model" | "responseId" | "usage"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractModelJson(raw)) as unknown;
  } catch {
    throw new TeamAgentModelError("malformed");
  }
  if (!parsed || typeof parsed !== "object") throw new TeamAgentModelError("malformed");
  const body = parsed as Record<string, unknown>;
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!reply) throw new TeamAgentModelError("empty");

  const allowed = new Set(allowedTopicIds);
  const topicIds = Array.isArray(body.topicIds)
    ? body.topicIds.filter((id): id is string => typeof id === "string" && allowed.has(id))
    : [];

  const proposedActions: AgentActionProposal[] = [];
  if (Array.isArray(body.proposedActions)) {
    for (const item of body.proposedActions) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type : "";
      const payload =
        typeof row.payloadJson === "string" ? parsePayload(row.payloadJson) : null;
      if (!payload) continue;
      const action = acceptAction(type, payload);
      if (action) proposedActions.push(action);
    }
  }

  if (Array.isArray(body.memoryProposals)) {
    for (const item of body.memoryProposals) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const memoryType = typeof row.memory_type === "string" ? row.memory_type : "";
      if (!MEMORY_TYPES.has(memoryType as TeamAgentMemoryType)) continue;
      const action = acceptAction("record_memory", {
        memory_type: memoryType,
        subject: row.subject,
        content: row.content,
      });
      if (action) proposedActions.push(action);
    }
  }

  const summaryUpdates = Array.isArray(body.topicSummaryUpdates)
    ? body.topicSummaryUpdates.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.topicId !== "string" || !allowed.has(row.topicId)) return [];
        if (typeof row.summary !== "string" || !row.summary.trim()) return [];
        return [{ topicId: row.topicId, summary: row.summary.trim().slice(0, 4000) }];
      })
    : [];

  const needsHumanApproval = proposedActions.some(
    (a) => a.type === "assign_task" || a.type === "propose_assignment_batch",
  );

  return {
    replyText: reply.slice(0, REPLY_CAP),
    proposedActions,
    needsHumanApproval,
    topicIds,
    summaryUpdates,
  };
}

function classifyCallerError(err: unknown): TeamAgentModelError {
  if (err instanceof TeamAgentModelError) return err;
  const status = httpStatusOf(err) ?? 0;
  const message = errorText(err);
  const name = err instanceof Error ? err.name : "";
  const billing = classifyBillingFailure(status, message);
  const wrap = (code: TeamAgentModelErrorCode) => new TeamAgentModelError(code, { cause: err });
  if (billing) return wrap(billing);
  if (status === 401 || status === 403) return wrap("invalid_api_key");
  if (status === 400) return wrap("malformed");
  if (status === 429) return wrap("rate_limited");
  if (status >= 500) return wrap("upstream");
  if (
    name === "APIConnectionTimeoutError" ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "APIConnectionError"
  ) {
    return wrap("timeout");
  }
  return wrap("request_failed");
}

function httpStatusOf(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("status" in err)) return null;
  const status = Number((err as { status: unknown }).status);
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  return status;
}

function pickProviderId(value: unknown): string | null {
  return typeof value === "string" && ID_RE.test(value) ? value : null;
}

function providerIdsOf(err: unknown): { requestId: string | null; responseId: string | null } {
  if (!err || typeof err !== "object") return { requestId: null, responseId: null };
  const rec = err as Record<string, unknown>;
  const direct =
    pickProviderId(rec.request_id) ??
    pickProviderId(rec.requestID) ??
    pickProviderId(rec.requestId);
  let headerId: string | null = null;
  const headers = rec.headers;
  if (headers instanceof Headers) {
    headerId = pickProviderId(headers.get("x-request-id"));
  } else if (headers && typeof headers === "object") {
    const bag = headers as Record<string, unknown>;
    headerId = pickProviderId(bag["x-request-id"]);
  }
  const responseId = pickProviderId(rec.id) ?? pickProviderId(rec.response_id);
  return { requestId: direct ?? headerId, responseId };
}

function readProviderTag(err: unknown): { stage: string | null; responseId: string | null } {
  if (!err || typeof err !== "object") return { stage: null, responseId: null };
  const rec = err as Record<string, unknown>;
  const stage = typeof rec[PROVIDER_STAGE_KEY] === "string" ? String(rec[PROVIDER_STAGE_KEY]) : null;
  const responseId = pickProviderId(rec[PROVIDER_RESPONSE_KEY]);
  return { stage, responseId };
}

function tagProviderError(err: unknown, stage: string, responseId: string | null): void {
  if (!err || typeof err !== "object") return;
  Object.defineProperty(err, PROVIDER_STAGE_KEY, { value: stage, configurable: true });
  if (responseId) {
    Object.defineProperty(err, PROVIDER_RESPONSE_KEY, { value: responseId, configurable: true });
  }
}

/** Stage of an exception thrown while the SDK call is running. Status means an HTTP response arrived. */
export function inferInFlightStage(err: unknown): ProviderCallStage {
  const name = err instanceof Error ? err.name : "";
  const message = errorText(err).toLowerCase();
  if (httpStatusOf(err)) return "http_response";
  if (
    name === "APIConnectionTimeoutError" ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "await_response";
  }
  if (
    name === "APIConnectionError" ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("socket") ||
    message.includes("connection")
  ) {
    return "connect";
  }
  return "await_response";
}

function safeErrorText(text: string): string {
  const clean = redactSecrets(text)
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]");
  if (clean.length <= 240) return clean;
  return `${clean.slice(0, 240)}…`;
}

function namedError(err: unknown): { name: string | null; message: string | null } {
  if (err instanceof Error) {
    return { name: err.name || "Error", message: safeErrorText(err.message) };
  }
  if (typeof err === "string") return { name: "string", message: safeErrorText(err) };
  if (err && typeof err === "object") {
    const rec = err as { name?: unknown; message?: unknown; constructor?: { name?: string } };
    const name = typeof rec.name === "string" ? rec.name : rec.constructor?.name ?? "object";
    const message = "message" in rec ? safeErrorText(String(rec.message)) : null;
    return { name, message };
  }
  return { name: err == null ? null : typeof err, message: null };
}

/** Safe fields for a provider failure. Does not include prompts, headers, or secrets. */
export function describeProviderFailure(err: unknown, fallbackStage: string): ProviderFailureLog {
  const named = namedError(err);
  const tagged = readProviderTag(err);
  const ids = providerIdsOf(err);
  let causeName: string | null = null;
  let causeMessage: string | null = null;
  let stage = tagged.stage ?? fallbackStage;
  let httpStatus = httpStatusOf(err);
  let requestId = ids.requestId;
  let responseId = tagged.responseId ?? ids.responseId;

  const origin =
    err instanceof TeamAgentModelError
      ? err.origin
      : err instanceof Error
        ? err.cause
        : null;
  if (origin != null && origin !== err) {
    const cause = namedError(origin);
    causeName = cause.name;
    causeMessage = cause.message;
  }
  if (err instanceof TeamAgentModelError) {
    stage = err.providerStage ?? stage;
    httpStatus = err.httpStatus;
    requestId = err.providerRequestId;
    responseId = err.providerResponseId;
  }

  return {
    exception_name: named.name,
    exception_message: named.message,
    cause_name: causeName,
    cause_message: causeMessage,
    http_status: httpStatus,
    stage,
    provider_request_id: requestId,
    provider_response_id: responseId,
  };
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) return String((err as { message: unknown }).message);
  return "";
}

const RETRYABLE = new Set<TeamAgentModelErrorCode>(["rate_limited", "upstream"]);

async function callWithLimit(caller: TeamAgentModelCaller, request: TeamAgentModelRequest) {
  let last: TeamAgentModelError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await caller(request);
    } catch (err) {
      if (!readProviderTag(err).stage) tagProviderError(err, inferInFlightStage(err), null);
      last = classifyCallerError(err);
      const retry = RETRYABLE.has(last.code);
      if (!retry || attempt === 1) throw last;
    }
  }
  throw last ?? new TeamAgentModelError("request_failed");
}

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";

export type TeamAgentSdkClientOptions = {
  apiKey: string;
  timeout: number;
  maxRetries: 0;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
};

/**
 * Direct OpenAI and OpenRouter share one caller.
 * OpenRouter rejects store:true and previous_response_id. The request keeps store:false and never sends previous_response_id.
 */
export function teamAgentSdkClientOptions(
  env: NodeJS.ProcessEnv,
): TeamAgentSdkClientOptions | null {
  const config = loadTeamAgentConfig(env);
  const timeout = 28_000;
  if (config.provider === "openrouter") {
    const apiKey = (env.OPENROUTER_API_KEY ?? "").trim();
    if (!apiKey) return null;
    return {
      apiKey,
      timeout,
      maxRetries: 0,
      baseURL: OPENROUTER_API_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://www.kroogy.com",
        "X-OpenRouter-Title": "Kroogy Team Agent",
      },
    };
  }
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return { apiKey, timeout, maxRetries: 0 };
}

function visibleOutputText(response: {
  output_text?: string | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}): string {
  const direct = response.output_text?.trim() ?? "";
  if (direct) return direct;
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const block of item.content ?? []) {
      if (block.text) parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function defaultCaller(env: NodeJS.ProcessEnv): TeamAgentModelCaller {
  const options = teamAgentSdkClientOptions(env);
    if (!options) {
    return async () => {
      const err = new TeamAgentModelError("not_configured");
      tagProviderError(err, "before_http", null);
      throw err;
    };
  }
  const client = new OpenAI(options);
  return async (request) => {
    let responseId: string | null = null;
    try {
      const response = await client.responses.create({
        model: request.model,
        instructions: request.instructions,
        input: request.input,
        max_output_tokens: request.max_output_tokens,
        reasoning: request.reasoning,
        store: false,
        text: request.text,
      });
      responseId = typeof response.id === "string" ? response.id : null;
      let outputText = "";
      try {
        outputText = visibleOutputText(response);
      } catch (err) {
        tagProviderError(err, "parse", responseId);
        throw err;
      }
      return {
        id: response.id,
        output_text: outputText,
        usage: response.usage
          ? {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
              total_tokens: response.usage.total_tokens,
              input_tokens_details: {
                cached_tokens: response.usage.input_tokens_details?.cached_tokens,
              },
            }
          : undefined,
      };
    } catch (err) {
      if (!readProviderTag(err).stage) tagProviderError(err, inferInFlightStage(err), responseId);
      throw err;
    }
  };
}

export class OpenAITeamAgentProvider implements TeamAgentProvider {
  constructor(
    private opts: {
      env?: NodeJS.ProcessEnv;
      caller?: TeamAgentModelCaller;
      model?: string;
      maxContextChars?: number;
      maxOutputTokens?: number;
    } = {},
  ) {}

  async respond(
    context: TeamAgentContext,
    request: AgentRespondRequest,
  ): Promise<AgentRespondResult> {
    const env = this.opts.env ?? process.env;
    const config = loadTeamAgentConfig(env);
    const model = this.opts.model ?? config.model;
    const maxChars = this.opts.maxContextChars ?? config.maxContextChars;
    const maxOutputTokens = this.opts.maxOutputTokens ?? config.maxOutputTokens;
    const packed = buildTeamAgentModelInput(context, request, maxChars);
    const body: TeamAgentModelRequest = {
      model,
      instructions: TEAM_AGENT_SYSTEM_PROMPT_V1,
      input: packed.text,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: "low" },
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "team_agent_turn_v1",
          strict: true,
          schema: TEAM_AGENT_RESPONSE_SCHEMA,
        },
      },
    };
    const caller = this.opts.caller ?? defaultCaller(env);
    const response = await callWithLimit(caller, body);
    const raw = (response.output_text ?? "").trim();
    const responseId = response.id ?? null;
    if (!raw) throw new TeamAgentModelError("empty", { stage: "parse", responseId });
    let parsed: ReturnType<typeof parseTeamAgentModelOutput>;
    try {
      parsed = parseTeamAgentModelOutput(raw, packed.allowedTopicIds);
    } catch (err) {
      if (err instanceof TeamAgentModelError) {
        throw new TeamAgentModelError(err.code, { cause: err, stage: "parse", responseId });
      }
      tagProviderError(err, "parse", responseId);
      throw err;
    }
    const inputTokens = response.usage?.input_tokens ?? null;
    const outputTokens = response.usage?.output_tokens ?? null;
    const cached = response.usage?.input_tokens_details?.cached_tokens ?? null;
    const total =
      response.usage?.total_tokens ??
      (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);
    return {
      ...parsed,
      provider: loadTeamAgentConfig(env).provider === "openrouter" ? "openrouter" : "openai",
      model,
      responseId: response.id ?? null,
      usage: {
        input_tokens: inputTokens,
        cached_input_tokens: cached,
        output_tokens: outputTokens,
        total_tokens: total,
        prompt_version: TEAM_AGENT_SYSTEM_PROMPT_VERSION,
      },
    };
  }
}
