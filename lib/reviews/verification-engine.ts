/**
 * Review verification engine.
 *
 * MVP: rule-based question generation + answer heuristics.
 * Swap `RuleBasedVerificationEngine` for an LLM-backed implementation
 * that implements `VerificationEngine` — server actions stay the same.
 *
 * Never expose API keys to the client. Never claim truthfulness.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  ReviewVerificationMessage,
  ReviewVerificationSession,
} from "@/types/review";
import { MIN_ANSWER_BODY, MAX_ANSWER_BODY } from "@/types/review";

type Client = SupabaseClient<Database>;

export type VerificationQuestion = {
  questionType: string;
  body: string;
};

export type VerificationCompletionResult = {
  outcome: "published" | "manual_review";
  answered: number;
  required: number;
  complete: boolean;
};

export type VerificationEngine = {
  /** Create or resume a session for a review owned by the current user. */
  createVerificationSession(
    client: Client,
    reviewId: string,
  ): Promise<ReviewVerificationSession>;

  /** Next unanswered agent question, or null if waiting / done. */
  getNextVerificationQuestion(
    client: Client,
    sessionId: string,
  ): Promise<VerificationQuestion | null>;

  /** Submit an answer; may complete the session. */
  submitVerificationAnswer(
    client: Client,
    sessionId: string,
    answer: string,
  ): Promise<{
    answered: number;
    required: number;
    complete: boolean;
    outcome?: "published" | "manual_review";
  }>;

  /** Force completion evaluation (usually auto after last answer). */
  completeVerificationSession(
    client: Client,
    sessionId: string,
  ): Promise<VerificationCompletionResult>;
};

function mapSession(
  row: Database["public"]["Tables"]["review_verification_sessions"]["Row"],
  messages?: ReviewVerificationMessage[],
): ReviewVerificationSession {
  return {
    id: row.id,
    reviewId: row.review_id,
    userId: row.user_id,
    status: row.status,
    currentQuestionIndex: row.current_question_index,
    questionsRequired: row.questions_required,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    score: row.score,
    resultSummary: row.result_summary,
  };
}

function mapMessage(
  row: Database["public"]["Tables"]["review_verification_messages"]["Row"],
): ReviewVerificationMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    body: row.body,
    questionType: row.question_type,
    sequenceNumber: row.sequence_number,
    createdAt: row.created_at,
  };
}

/**
 * Builds clarifying question from review body (rule-based stand-in for LLM).
 * Used by app-layer UX helpers; DB RPC also embeds the same pattern.
 */
export function buildClarifyingQuestion(reviewBody: string): string {
  const snip = reviewBody.trim().slice(0, 80);
  const ellipsis = reviewBody.trim().length > 80 ? "…" : "";
  return `Вы написали: «${snip}${ellipsis}». Уточните, что повлияло на вашу оценку больше всего?`;
}

export function validateVerificationAnswer(answer: string): string | null {
  const trimmed = answer.trim();
  if (trimmed.length < MIN_ANSWER_BODY || trimmed.length > MAX_ANSWER_BODY) {
    return `Ответ: от ${MIN_ANSWER_BODY} до ${MAX_ANSWER_BODY} символов.`;
  }
  const letters = trimmed.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/gu, "");
  if (letters.length < 4) {
    return "Ответ слишком короткий или бессодержательный.";
  }
  const low = trimmed.toLowerCase();
  const banned = new Set([
    "да",
    "нет",
    "ok",
    "ок",
    "хорошо",
    "нормально",
    "хз",
    "не знаю",
    "asdf",
    "qwerty",
  ]);
  if (banned.has(low)) {
    return "Пожалуйста, ответьте содержательнее.";
  }
  return null;
}

/**
 * Future LLM hook: replace this class body with API calls.
 * Keep method signatures stable for server actions.
 */
export class RuleBasedVerificationEngine implements VerificationEngine {
  async createVerificationSession(
    client: Client,
    reviewId: string,
  ): Promise<ReviewVerificationSession> {
    const { data, error } = await client.rpc("create_verification_session", {
      p_review_id: reviewId,
    });
    if (error) throw error;
    const session = mapSession(data);
    const messages = await this.loadMessages(client, session.id);
    return { ...session, messages };
  }

  async getNextVerificationQuestion(
    client: Client,
    sessionId: string,
  ): Promise<VerificationQuestion | null> {
    const { data: session, error } = await client
      .from("review_verification_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!session) return null;
    if (
      session.status !== "pending" &&
      session.status !== "in_progress"
    ) {
      return null;
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      return null;
    }

    const messages = await this.loadMessages(client, sessionId);
    const agentQuestions = messages.filter(
      (m) => m.role === "agent" && m.questionType !== "intro",
    );
    const answered = messages.filter((m) => m.role === "user").length;
    const next = agentQuestions[answered];
    if (!next) return null;
    return {
      questionType: next.questionType ?? "question",
      body: next.body,
    };
  }

  async submitVerificationAnswer(
    client: Client,
    sessionId: string,
    answer: string,
  ): Promise<{
    answered: number;
    required: number;
    complete: boolean;
    outcome?: "published" | "manual_review";
  }> {
    const validation = validateVerificationAnswer(answer);
    if (validation) {
      throw new Error(validation);
    }

    const { data, error } = await client.rpc("submit_verification_answer", {
      p_session_id: sessionId,
      p_answer: answer.trim(),
    });
    if (error) throw error;

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      answered: Number(row.answered ?? 0),
      required: Number(row.required ?? 3),
      complete: Boolean(row.complete),
      outcome:
        row.outcome === "published" || row.outcome === "manual_review"
          ? row.outcome
          : undefined,
    };
  }

  async completeVerificationSession(
    client: Client,
    sessionId: string,
  ): Promise<VerificationCompletionResult> {
    const { data, error } = await client.rpc("complete_verification_session", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;
    const outcome =
      row.outcome === "manual_review" ? "manual_review" : "published";
    return {
      outcome,
      answered: Number(row.answered ?? 0),
      required: Number(row.required ?? 3),
      complete: true,
    };
  }

  async loadMessages(
    client: Client,
    sessionId: string,
  ): Promise<ReviewVerificationMessage[]> {
    const { data, error } = await client
      .from("review_verification_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence_number", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapMessage);
  }
}

/** Default engine instance — swap for LLM engine later. */
export const verificationEngine: VerificationEngine =
  new RuleBasedVerificationEngine();

/**
 * How to plug a real LLM later:
 * 1. Implement VerificationEngine (or subclass) that calls your provider
 *    only from server actions / route handlers.
 * 2. Keep create/submit/complete RPCs for status transitions & RLS.
 * 3. Optionally move question generation into an RPC that stores agent
 *    messages after the LLM returns — still with app.verification_engine flag.
 * 4. Scoring must stay server-side; never trust client-provided scores.
 */
