/**
 * Server-only search LLM client (paid OpenRouter → optional OpenAI/Anthropic).
 * Free models are off by default (slow queues). Keys never leave this module.
 */
import "server-only";

import { redactSecrets } from "@/lib/security/redact";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const DEFAULT_FREE_MODELS = [
  "openrouter/free",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
  "inclusionai/ling-3.0-flash:free",
  "nvidia/nemotron-nano-9b-v2:free",
] as const;

/**
 * Paid OpenRouter models for search-intent JSON.
 * Prefer fast/reliable nano first; cheaper models are failover only.
 * Prices ~$0.01–$0.10 / 1M input (as of listing check).
 */
const DEFAULT_CHEAP_PAID_MODELS = [
  "openai/gpt-4.1-nano", // ~$0.10 / $0.40 — fast, strong JSON
  "google/gemini-2.5-flash-lite", // ~$0.10 / $0.40
  "amazon/nova-micro-v1", // ~$0.035 / $0.14
  "qwen/qwen-2.5-7b-instruct", // ~$0.04 / $0.10
  "inclusionai/ling-2.6-flash", // ~$0.01 / $0.03
] as const;

/** Direct OpenAI fallback when OPENAI_API_KEY is set (no OpenRouter markup). */
const OPENAI_DIRECT_MODELS = ["gpt-4.1-nano", "gpt-4o-mini"] as const;

/**
 * Vision-capable models for reading text off an uploaded photo (admin OCR).
 * Cheapest multimodal first; callers pass an image, never a model id.
 */
const DEFAULT_VISION_MODELS = [
  "google/gemini-2.5-flash-lite",
  "openai/gpt-4.1-nano",
  "openai/gpt-4o-mini",
] as const;

/** Free multimodal fallback — admin OCR tolerates a slow queue, unlike search. */
const DEFAULT_FREE_VISION_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
] as const;

const VISION_ALLOWLIST = new Set<string>([
  ...DEFAULT_VISION_MODELS,
  ...DEFAULT_FREE_VISION_MODELS,
  "google/gemini-2.0-flash-001",
  "qwen/qwen2.5-vl-7b-instruct",
]);

/** Direct Anthropic fallback — Haiku only (cheapest that handles JSON intent). */
const ANTHROPIC_DIRECT_MODELS = ["claude-haiku-4-5-20251001"] as const;

const CHEAP_PAID_ALLOWLIST = new Set<string>([
  ...DEFAULT_CHEAP_PAID_MODELS,
  "meta-llama/llama-3.1-8b-instruct",
  "mistralai/ministral-3b-2512",
  "openai/gpt-4o-mini",
]);

const DEFAULT_TIMEOUT_MS = 12_000;

const unavailableModels = new Set<string>();

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(redactSecrets(message));
    this.name = "OpenRouterError";
  }
}

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenRouterCompletion = {
  content: string;
  modelUsed: string;
};

export function isAllowedFreeModel(model: string): boolean {
  const id = model.trim();
  if (!id) return false;
  if (id === "openrouter/free") return true;
  return id.endsWith(":free") && !id.includes(" ") && id.length < 120;
}

export function isAllowedCheapPaidModel(model: string): boolean {
  const id = model.trim();
  return CHEAP_PAID_ALLOWLIST.has(id) && !id.includes(" ") && id.length < 120;
}

export function isAllowedSearchModel(model: string): boolean {
  return isAllowedFreeModel(model) || isAllowedCheapPaidModel(model);
}

export function isAllowedVisionModel(model: string): boolean {
  const id = model.trim();
  return VISION_ALLOWLIST.has(id) && !id.includes(" ") && id.length < 120;
}

function parseCsvModels(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function getOpenRouterKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function getOpenAiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

function getAnthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function getFreeModelChain(): string[] {
  // Opt-in only — free queues are slow and were the main AI-search delay.
  const enabled =
    process.env.OPENROUTER_USE_FREE === "1" ||
    process.env.OPENROUTER_USE_FREE === "true";
  if (!enabled) return [];

  const fromEnv = parseCsvModels(process.env.OPENROUTER_FREE_MODELS).filter(
    isAllowedFreeModel,
  );
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_FREE_MODELS];
}

/** Paid multimodal first, then free — so OCR still works without credits. */
export function getVisionModelChain(): string[] {
  const fromEnv = parseCsvModels(process.env.OPENROUTER_VISION_MODELS).filter(
    isAllowedVisionModel,
  );
  if (fromEnv.length > 0) return fromEnv;
  return [...DEFAULT_VISION_MODELS, ...DEFAULT_FREE_VISION_MODELS];
}

export function getCheapPaidModelChain(): string[] {
  const fromEnv = parseCsvModels(process.env.OPENROUTER_CHEAP_MODELS).filter(
    isAllowedCheapPaidModel,
  );
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_CHEAP_PAID_MODELS];
}

/** Paid OpenRouter first; free only if OPENROUTER_USE_FREE=1. */
export function getSearchModelChain(): string[] {
  return [...getCheapPaidModelChain(), ...getFreeModelChain()];
}

function siteReferer(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  return "https://krugi.app";
}

function extractMessageContent(body: {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning?: string;
    };
  }>;
}): string {
  const message = body.choices?.[0]?.message;
  if (!message) return "";

  const raw = message.content;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    const joined = raw
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (joined) return joined;
  }

  const reasoning = typeof message.reasoning === "string" ? message.reasoning : "";
  if (reasoning.trim()) {
    const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
  }
  return "";
}

async function completeOpenRouter(
  model: string,
  messages: OpenRouterMessage[],
  timeoutMs: number,
  options: { jsonMode: boolean },
): Promise<string> {
  if (!isAllowedSearchModel(model)) {
    throw new OpenRouterError(`Model not allowlisted: ${model}`, 403, false);
  }
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload: Record<string, unknown> = {
      model,
      temperature: 0,
      messages,
    };
    if (options.jsonMode) {
      payload.response_format = { type: "json_object" };
    }

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": siteReferer(),
        "X-Title": "Krugi",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404) unavailableModels.add(model);
      const retryable =
        res.status === 429 ||
        res.status === 402 ||
        res.status === 404 ||
        (res.status >= 500 && res.status <= 599);
      throw new OpenRouterError(
        `HTTP ${res.status}: ${redactSecrets(text.slice(0, 200))}`,
        res.status,
        retryable,
      );
    }

    let body: Parameters<typeof extractMessageContent>[0];
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new OpenRouterError("Invalid JSON from OpenRouter", res.status, true);
    }

    const content = extractMessageContent(body);
    if (!content) {
      throw new OpenRouterError("Empty model response", res.status, true);
    }
    return content;
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenRouterError("timeout", null, true);
    }
    throw new OpenRouterError(
      err instanceof Error ? redactSecrets(err.message) : "request failed",
      null,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function completeVisionOpenRouter(
  model: string,
  prompt: string,
  imageDataUrl: string,
  timeoutMs: number,
): Promise<string> {
  if (!isAllowedVisionModel(model)) {
    throw new OpenRouterError(`Model not allowlisted: ${model}`, 403, false);
  }
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": siteReferer(),
        "X-Title": "Krugi",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404) unavailableModels.add(model);
      const retryable =
        res.status === 429 ||
        res.status === 402 ||
        res.status === 404 ||
        (res.status >= 500 && res.status <= 599);
      throw new OpenRouterError(
        `HTTP ${res.status}: ${redactSecrets(text.slice(0, 200))}`,
        res.status,
        retryable,
      );
    }

    let body: Parameters<typeof extractMessageContent>[0];
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new OpenRouterError("Invalid JSON from OpenRouter", res.status, true);
    }

    const content = extractMessageContent(body);
    if (!content) {
      throw new OpenRouterError("Empty model response", res.status, true);
    }
    return content;
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenRouterError("timeout", null, true);
    }
    throw new OpenRouterError(
      err instanceof Error ? redactSecrets(err.message) : "request failed",
      null,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read an image with a vision model. The image must already be a data URL —
 * callers never choose the model, so no client can point us at an arbitrary one.
 */
export async function completeVisionWithFailover(
  prompt: string,
  imageDataUrl: string,
  options?: { timeoutMs?: number },
): Promise<OpenRouterCompletion> {
  const timeoutMs = options?.timeoutMs ?? 25_000;
  if (!getOpenRouterKey()) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured");
  }

  const errors: string[] = [];
  const models = getVisionModelChain().filter(
    (model) => !unavailableModels.has(model),
  );
  for (const model of models) {
    try {
      const content = await completeVisionOpenRouter(
        model,
        prompt,
        imageDataUrl,
        timeoutMs,
      );
      return { content, modelUsed: model };
    } catch (err) {
      errors.push(
        `${model}: ${err instanceof OpenRouterError ? err.message : "failed"}`,
      );
    }
  }

  throw new OpenRouterError(
    `All vision models failed: ${errors.join(" | ") || "no models available"}`,
    null,
    false,
  );
}

async function completeOpenAiDirect(
  model: string,
  messages: OpenRouterMessage[],
  timeoutMs: number,
): Promise<string> {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    throw new OpenRouterError("OPENAI_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status <= 599);
      throw new OpenRouterError(
        `OpenAI HTTP ${res.status}: ${redactSecrets(text.slice(0, 200))}`,
        res.status,
        retryable,
      );
    }

    let body: Parameters<typeof extractMessageContent>[0];
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new OpenRouterError("Invalid JSON from OpenAI", res.status, true);
    }

    const content = extractMessageContent(body);
    if (!content) {
      throw new OpenRouterError("Empty OpenAI response", res.status, true);
    }
    return content;
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenRouterError("timeout", null, true);
    }
    throw new OpenRouterError(
      err instanceof Error ? redactSecrets(err.message) : "request failed",
      null,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function completeAnthropicDirect(
  model: string,
  messages: OpenRouterMessage[],
  timeoutMs: number,
): Promise<string> {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new OpenRouterError("ANTHROPIC_API_KEY is not configured");
  }

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: 0,
        system: system || undefined,
        messages: chatMessages,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status <= 599);
      throw new OpenRouterError(
        `Anthropic HTTP ${res.status}: ${redactSecrets(text.slice(0, 200))}`,
        res.status,
        retryable,
      );
    }

    let body: {
      content?: Array<{ type?: string; text?: string }>;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new OpenRouterError("Invalid JSON from Anthropic", res.status, true);
    }

    const content = (body.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();

    if (!content) {
      throw new OpenRouterError("Empty Anthropic response", res.status, true);
    }
    return content;
  } catch (err) {
    if (err instanceof OpenRouterError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenRouterError("timeout", null, true);
    }
    throw new OpenRouterError(
      err instanceof Error ? redactSecrets(err.message) : "request failed",
      null,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function tryModel(
  model: string,
  messages: OpenRouterMessage[],
  timeoutMs: number,
): Promise<string> {
  try {
    return await completeOpenRouter(model, messages, timeoutMs, {
      jsonMode: true,
    });
  } catch (err) {
    if (
      err instanceof OpenRouterError &&
      (err.message.includes("Empty model response") || err.status === 400)
    ) {
      return completeOpenRouter(model, messages, timeoutMs, { jsonMode: false });
    }
    throw err;
  }
}

/**
 * Paid OpenRouter (nano first) → direct OpenAI nano/mini → Anthropic Haiku.
 * Free OpenRouter only if OPENROUTER_USE_FREE=1. Callers cannot inject models.
 */
export async function completeJsonWithFailover(
  messages: OpenRouterMessage[],
  options?: { timeoutMs?: number },
): Promise<OpenRouterCompletion> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const errors: string[] = [];

  if (getOpenRouterKey()) {
    const models = getSearchModelChain().filter(
      (model) => !unavailableModels.has(model),
    );

    for (const model of models) {
      try {
        const content = await tryModel(model, messages, timeoutMs);
        return { content, modelUsed: model };
      } catch (err) {
        errors.push(
          `${model}: ${err instanceof OpenRouterError ? err.message : "failed"}`,
        );
      }
    }
  } else {
    errors.push("openrouter: key missing");
  }

  // Direct OpenAI — cheapest nano then mini.
  if (getOpenAiKey()) {
    for (const model of OPENAI_DIRECT_MODELS) {
      try {
        const content = await completeOpenAiDirect(model, messages, timeoutMs);
        return { content, modelUsed: `openai-direct:${model}` };
      } catch (err) {
        errors.push(
          `openai:${model}: ${
            err instanceof OpenRouterError ? err.message : "failed"
          }`,
        );
      }
    }
  }

  // Direct Anthropic Haiku — last resort (more expensive than nano).
  if (getAnthropicKey()) {
    for (const model of ANTHROPIC_DIRECT_MODELS) {
      try {
        const content = await completeAnthropicDirect(
          model,
          messages,
          timeoutMs,
        );
        return { content, modelUsed: `anthropic-direct:${model}` };
      } catch (err) {
        errors.push(
          `anthropic:${model}: ${
            err instanceof OpenRouterError ? err.message : "failed"
          }`,
        );
      }
    }
  }

  throw new OpenRouterError(
    `All search models failed: ${errors.join(" | ") || "no models available"}`,
    null,
    false,
  );
}
