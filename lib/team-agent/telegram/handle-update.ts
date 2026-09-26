/**
 * Telegram update → ingest → optional agent reply.
 * Production path uses Supabase store; tests inject InMemory.
 */

import { randomUUID } from "node:crypto";
import { consumeAiBudget, storedAiBudgetDecision } from "../ai-budget";
import type { TeamAgentProvider } from "../agent-provider";
import { approvePendingAssignment } from "../actions";
import { formatCapabilitiesReply, formatStatusReply, type CapabilityFacts } from "../capabilities";
import { loadTeamAgentConfig } from "../config";
import { formatProjectAnswer, snapshotBrief } from "../control/report";
import { cachedProjectSnapshot, observeProject } from "../control/live";
import { buildTeamAgentContext } from "../context";
import {
  GitHubRepositoryContextProvider,
  githubConfigFromEnv,
  unavailableRepository,
} from "../github-repository";
import { claimAgentReply, ingestTeamMessage, markMessageAgentReplied, persistAgentReply } from "../ingest";
import { parseLocalCommand } from "../local-commands";
import { quotePartnerSpeech, runTaskIntent } from "../task-intent";
import { TeamAgentModelError, describeProviderFailure, publicFailureText } from "../openai-provider";
import { createTeamAgentProvider } from "../provider-factory";
import type { TeamAgentStore } from "../store-port";
import { linkMessageToTopics } from "../topics";
import {
  DeterministicTopicClassifier,
  resolveInvocationTopics,
  type TopicClassifier,
} from "../topic-classifier";
import {
  canPinMessages,
  splitTelegramText,
  telegramEditMessageText,
  telegramGetChatMember,
  telegramGetMe,
  telegramPinChatMessage,
  telegramSendMessage,
} from "./bot-api";
import { connectionFacts, formatProjectBrief } from "../project-brief";
import { refreshPinnedProjectStatus } from "../project-status";
import { normalizeTelegramUpdate } from "./normalize";
import type { TelegramUpdate } from "./types";

export type HandleTelegramUpdateResult = {
  status:
    | "disabled"
    | "ignored"
    | "ingested"
    | "replied"
    | "provider_error";
  reason?: string;
  shouldRespond?: boolean;
  replySent?: boolean;
  providerCalls?: number;
  stored?: boolean;
};

export async function handleTelegramUpdate(input: {
  update: TelegramUpdate;
  store: TeamAgentStore;
  env?: NodeJS.ProcessEnv;
  provider?: TeamAgentProvider;
  botUserId?: number | null;
  /** When false, skip privileged action execution for unknown members (default). */
  allowUnknownPrivilegedActions?: boolean;
  topicClassifier?: TopicClassifier;
  observe?: () => Promise<import("../control/types").ProjectSnapshot>;
}): Promise<HandleTelegramUpdateResult> {
  const env = input.env ?? process.env;
  const config = loadTeamAgentConfig(env);

  if (!config.enabled) {
    return { status: "disabled", reason: "TEAM_AGENT_ENABLED off", providerCalls: 0, stored: false };
  }

  const normalized = normalizeTelegramUpdate(input.update, {
    ...config,
    botUserId: input.botUserId ?? null,
  });
  if (normalized.ignored || !normalized.ingest) {
    return {
      status: "ignored",
      reason: normalized.ignoreReason,
      providerCalls: 0,
      stored: false,
    };
  }

  const ingest = await ingestTeamMessage(input.store, {
    ...normalized.ingest,
    botUsername: config.botUsername,
    mentionTokens: config.mentionTokens,
    explicitCommands: config.explicitCommands,
  });

  const requestId = randomUUID();
  const quietEarly = await quietReply({
    store: input.store,
    text: ingest.message.body,
    member: ingest.member,
    conversationId: ingest.conversation.id,
  });
  if (quietEarly) {
    const sent = await sendReply(
      normalized.ingest.conversationExternalId,
      quietEarly.text,
      normalized.ingest.messageExternalId,
      env,
      threadFrom(ingest.message.metadata),
    );
    const persisted = await persistAgentReply(input.store, {
      conversationId: ingest.conversation.id,
      triggerMessage: ingest.message,
      replyText: quietEarly.text,
      telegramMessageIds: sent.ids,
      provider: null,
      model: null,
      updateId: input.update.update_id,
      requestId,
    });
    await markMessageAgentReplied(input.store, ingest.message.id, persisted.message.id);
    if (quietEarly.taskId) {
      const selection = await resolveInvocationTopics(
        input.store,
        ingest.message,
        input.topicClassifier ?? new DeterministicTopicClassifier(),
      );
      const topicIds = [
        ...(selection.primaryTopicId ? [selection.primaryTopicId] : []),
        ...selection.secondaryTopicIds,
      ];
      for (const topicId of topicIds) {
        await input.store.linkSubjectToTopic({ topicId, taskId: quietEarly.taskId });
      }
    }
    if (quietEarly.changed) {
      await syncPinnedStatus({
        store: input.store,
        conversationId: ingest.conversation.id,
        chatId: normalized.ingest.conversationExternalId,
        threadId: threadFrom(ingest.message.metadata),
        env,
        botUserId: input.botUserId ?? null,
      });
    }
    return {
      status: sent.ok ? "replied" : "provider_error",
      reason: sent.ok ? "task_intent" : sent.error,
      shouldRespond: true,
      replySent: sent.ok,
      providerCalls: 0,
      stored: true,
    };
  }

  if (!ingest.shouldRespond) {
    return {
      status: "ingested",
      reason: ingest.duplicate
        ? ingest.respondReason ?? "duplicate"
        : ingest.respondReason ?? "listen_only",
      shouldRespond: false,
      providerCalls: 0,
      stored: true,
    };
  }

  // Duplicate webhook retry after a successful reply — do not call provider again.
  if (ingest.duplicate && ingest.respondReason === "already_replied") {
    return {
      status: "ingested",
      reason: "already_replied",
      shouldRespond: false,
      providerCalls: 0,
      stored: true,
    };
  }

  let selectedTopicIds: string[] = [];
  if (ingest.shouldRespond) {
    const selection = await resolveInvocationTopics(
      input.store,
      ingest.message,
      input.topicClassifier ?? new DeterministicTopicClassifier(),
    );
    selectedTopicIds = [
      ...(selection.primaryTopicId ? [selection.primaryTopicId] : []),
      ...selection.secondaryTopicIds,
    ];
  }

  const local = parseLocalCommand(ingest.message.body, config.botUsername);
  const githubReady = Boolean(githubConfigFromEnv(env));
  if (local && !(local.kind === "github_unavailable" && githubReady)) {
    const text = await localReply(local, {
      store: input.store,
      env,
      memberId: ingest.member?.id ?? null,
      conversationId: ingest.conversation.id,
      chatId: normalized.ingest.conversationExternalId,
      threadId: threadFrom(ingest.message.metadata),
      botUserId: input.botUserId ?? null,
      facts: capabilityFacts(env, config),
      observe: input.observe,
    });
    const sent = await sendReply(
      normalized.ingest.conversationExternalId,
      text,
      normalized.ingest.messageExternalId,
      env,
      threadFrom(ingest.message.metadata),
    );
    const persisted = await persistAgentReply(input.store, {
      conversationId: ingest.conversation.id,
      triggerMessage: ingest.message,
      replyText: text,
      telegramMessageIds: sent.ids,
      provider: null,
      model: null,
      topicIds: selectedTopicIds,
      updateId: input.update.update_id,
      requestId,
    });
    await markMessageAgentReplied(input.store, ingest.message.id, persisted.message.id);
    return {
      status: sent.ok ? "replied" : "provider_error",
      reason: sent.ok ? local.kind : sent.error,
      shouldRespond: true,
      replySent: sent.ok,
      providerCalls: 0,
      stored: true,
    };
  }

  const claim = await claimAgentReply(input.store, {
    conversationId: ingest.conversation.id,
    triggerMessage: ingest.message,
    requestId,
  });
  if (!claim.claimed) {
    const saved = claim.message;
    const deliveredIds = saved?.metadata.telegram_message_ids;
    const delivered = Array.isArray(deliveredIds) && deliveredIds.length > 0;
    if (saved?.body && saved.metadata.agent_state === "completed" && !delivered) {
      const sent = await sendReply(
        normalized.ingest.conversationExternalId,
        saved.body,
        normalized.ingest.messageExternalId,
        env,
        threadFrom(ingest.message.metadata),
      );
      if (sent.ids.length) {
        await input.store.updateMessage(saved.id, {
          metadata: { ...saved.metadata, telegram_message_ids: sent.ids },
        });
      }
      await markMessageAgentReplied(input.store, ingest.message.id, saved.id);
      return {
        status: sent.ok ? "replied" : "provider_error",
        reason: sent.ok ? "redelivered" : sent.error,
        shouldRespond: true,
        replySent: sent.ok,
        providerCalls: 0,
        stored: true,
      };
    }
    if (claim.message) {
      await markMessageAgentReplied(input.store, ingest.message.id, claim.message.id);
    }
    return {
      status: "ingested",
      reason: "already_replied",
      shouldRespond: false,
      providerCalls: 0,
      stored: true,
    };
  }

  if (!input.provider) {
    const recent = await input.store.listRecentMessages(ingest.conversation.id, 80);
    const stored = storedAiBudgetDecision({
      messages: recent,
      memberId: ingest.member?.id ?? null,
    });
    const memory = consumeAiBudget(`ai:${ingest.member?.id ?? "unknown"}`, {
      limit: 6,
      windowMs: 10 * 60 * 1000,
    });
    if (!stored.ok || !memory.ok) {
      const text = stored.ok
        ? "Слишком много запросов к AI подряд. Подождите несколько минут."
        : stored.scope === "member"
          ? "Для этого участника сейчас слишком много запросов к AI. Подождите несколько минут. Остальные могут писать."
          : "Слишком много запросов к AI подряд. Подождите несколько минут.";
      await persistAgentReply(input.store, {
        conversationId: ingest.conversation.id,
        triggerMessage: ingest.message,
        replyText: text,
        provider: null,
        model: null,
        requestId,
      });
      const sent = await sendReply(
        normalized.ingest.conversationExternalId,
        text,
        normalized.ingest.messageExternalId,
        env,
        threadFrom(ingest.message.metadata),
      );
      await markMessageAgentReplied(input.store, ingest.message.id, claim.message?.id);
      return {
        status: sent.ok ? "replied" : "provider_error",
        reason: "ai_budget",
        shouldRespond: true,
        replySent: sent.ok,
        providerCalls: 0,
        stored: true,
      };
    }
  }

  let providerCalls = 0;
  let handlerStage = "before_http";
  let spoken: Awaited<ReturnType<NonNullable<typeof input.provider>["respond"]>> | null = null;
  try {
    const context = await buildTeamAgentContext(input.store, {
      conversationId: ingest.conversation.id,
      requestingMember: ingest.member,
      triggerMessage: ingest.message,
      repositoryProvider: repositoryProvider(env),
      maxMessages: config.maxContextMessages,
    });
    const cached = cachedProjectSnapshot();
    context.projectLines = cached
      ? snapshotBrief(cached)
      : ["Свежего снимка проекта нет. Команда для проверки: дай статус проекта."];

    const provider = input.provider ?? createTeamAgentProvider(env);
    providerCalls += 1;
    const reply = await provider.respond(
      context,
      {
        triggerMessage: ingest.message,
        userText: ingest.message.body,
      },
      input.store,
    );
    spoken = reply;
    handlerStage = "after_model";

    const allowedTopicIds = new Set<string>([
      ...selectedTopicIds,
      ...context.topics.map((t) => t.id),
    ]);
    for (const id of reply.topicIds ?? []) {
      if (!allowedTopicIds.has(id) || selectedTopicIds.includes(id)) continue;
      if (selectedTopicIds.length >= config.maxSelectedTopics) break;
      selectedTopicIds.push(id);
    }
    if (selectedTopicIds.length) {
      await linkMessageToTopics(input.store, ingest.message.id, selectedTopicIds);
    }
    for (const update of reply.summaryUpdates ?? []) {
      if (!allowedTopicIds.has(update.topicId)) continue;
      const topic = await input.store.getTopicById(update.topicId);
      if (!topic) continue;
      await input.store.upsertTopic({
        ...topic,
        summary: update.summary.slice(0, 4000),
        metadata: {
          ...topic.metadata,
          summary_updated_at: new Date().toISOString(),
          summary_source: "provider",
          summary_version: Number(topic.metadata.summary_version ?? 0) + 1,
        },
      });
    }

    const replyText = reply.replyText;
    handlerStage = "persist";
    await persistAgentReply(input.store, {
      conversationId: ingest.conversation.id,
      triggerMessage: ingest.message,
      replyText,
      provider: reply.provider ?? "mock",
      model: reply.model ?? null,
      responseId: reply.responseId ?? null,
      usage: reply.usage ?? null,
      topicIds: selectedTopicIds,
      updateId: input.update.update_id,
      requestId,
    });
    handlerStage = "telegram_send";
    const sent = await sendReply(
      normalized.ingest.conversationExternalId,
      replyText,
      normalized.ingest.messageExternalId,
      env,
      threadFrom(ingest.message.metadata),
    );
    if (sent.ids.length && claim.message) {
      await input.store.updateMessage(claim.message.id, {
        metadata: { telegram_message_ids: sent.ids },
      });
    } else if (!sent.ok) {
      console.error(
        JSON.stringify({
          error_type: sent.error ?? "telegram_send_failed",
          provider: reply.provider ?? config.provider,
          model: reply.model ?? config.model,
          request_id: requestId,
          telegram_message_id: ingest.message.external_message_id,
          stage: "telegram_send",
          timestamp: new Date().toISOString(),
        }),
      );
    }
    await linkMessageToTopics(input.store, claim.message!.id, selectedTopicIds);
    if (sent.ok) await markMessageAgentReplied(input.store, ingest.message.id, claim.message!.id);

    return {
      status: sent.ok ? "replied" : "provider_error",
      reason: sent.ok ? undefined : sent.error,
      shouldRespond: true,
      replySent: sent.ok,
      providerCalls,
      stored: true,
    };
  } catch (err) {
    const code = err instanceof TeamAgentModelError ? err.code : "provider_error";
    const failure = describeProviderFailure(err, handlerStage);
    console.error(
      JSON.stringify({
        error_type: code,
        provider: config.provider,
        model: config.model,
        request_id: requestId,
        telegram_message_id: ingest.message.external_message_id,
        stage: failure.stage,
        exception_name: failure.exception_name,
        exception_message: failure.exception_message,
        cause_name: failure.cause_name,
        cause_message: failure.cause_message,
        http_status: failure.http_status,
        provider_request_id: failure.provider_request_id,
        provider_response_id: failure.provider_response_id,
        timestamp: new Date().toISOString(),
      }),
    );
    if (spoken?.replyText) {
      const text = spoken.replyText;
      if (claim.message) {
        await persistAgentReply(input.store, {
          conversationId: ingest.conversation.id,
          triggerMessage: ingest.message,
          replyText: text,
          provider: spoken.provider ?? null,
          model: spoken.model ?? null,
          responseId: spoken.responseId ?? null,
          usage: spoken.usage ?? null,
          requestId,
          updateId: input.update.update_id,
          errorType: "post_model",
        });
      }
      const sent = await sendReply(
        normalized.ingest.conversationExternalId,
        text,
        normalized.ingest.messageExternalId,
        env,
        threadFrom(ingest.message.metadata),
      );
      if (sent.ok && claim.message) {
        await markMessageAgentReplied(input.store, ingest.message.id, claim.message.id);
      }
      return {
        status: sent.ok ? "replied" : "provider_error",
        reason: code,
        shouldRespond: true,
        replySent: sent.ok,
        providerCalls,
        stored: true,
      };
    }
    const text = publicFailureText(code);
    if (claim.message) {
      await persistAgentReply(input.store, {
        conversationId: ingest.conversation.id,
        triggerMessage: ingest.message,
        replyText: text,
        provider: null,
        model: null,
        requestId,
        updateId: input.update.update_id,
        errorType: code,
        responseId: err instanceof TeamAgentModelError ? err.providerResponseId : null,
      });
    }
    const sent = await sendReply(
      normalized.ingest.conversationExternalId,
      text,
      normalized.ingest.messageExternalId,
      env,
      threadFrom(ingest.message.metadata),
    );
    if (sent.ok && claim.message) {
      await markMessageAgentReplied(input.store, ingest.message.id, claim.message.id);
    }
    return {
      status: "provider_error",
      reason: code,
      shouldRespond: true,
      replySent: sent.ok,
      providerCalls,
      stored: true,
    };
  }
}

function repositoryProvider(env: NodeJS.ProcessEnv) {
  const github = githubConfigFromEnv(env);
  if (!github) {
    return { getContext: () => unavailableRepository("GitHub: не подключён.") };
  }
  return new GitHubRepositoryContextProvider(github);
}

function capabilityFacts(
  env: NodeJS.ProcessEnv,
  config: ReturnType<typeof loadTeamAgentConfig>,
): CapabilityFacts {
  const github = githubConfigFromEnv(env);
  const aiReady =
    (config.provider === "openrouter" && Boolean(env.OPENROUTER_API_KEY?.trim())) ||
    (config.provider === "openai" && Boolean(env.OPENAI_API_KEY?.trim())) ||
    config.provider === "mock";
  return {
    telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && config.allowedChatId),
    persistenceConfigured: true,
    topicMemory: true,
    github: github ? "available" : "not_configured",
    ai: aiReady ? "available" : config.provider === "mock" ? "available" : "not_configured",
    providerLabel: config.provider,
    model: config.model,
  };
}

async function localReply(
  command: NonNullable<ReturnType<typeof parseLocalCommand>>,
  input: {
    store: TeamAgentStore;
    env: NodeJS.ProcessEnv;
    memberId: string | null;
    conversationId: string;
    chatId: string;
    threadId: number | null;
    botUserId: number | null;
    facts: CapabilityFacts;
    observe?: () => Promise<import("../control/types").ProjectSnapshot>;
  },
): Promise<string> {
  if (command.kind === "project") {
    try {
      const snapshot = input.observe ? await input.observe() : await loadSnapshot(input.store, input.env);
      return formatProjectAnswer(command.topic, snapshot);
    } catch {
      return "Не удалось собрать статус проекта. Подключённые источники при этом не объявляются сломанными все сразу.";
    }
  }
  if (command.kind === "help") return formatCapabilitiesReply(input.facts);
  if (command.kind === "github_unavailable") {
    return "GitHub не подключён. Я не вижу ветки, коммиты и pull request и не буду их выдумывать.";
  }
  if (command.kind === "approve_invalid") {
    return "Подтверждение принимает только /agent approve и id предложения.";
  }
  if (command.kind === "brief" || command.kind === "brief_refresh") {
    const [tasks, members, recent] = await Promise.all([
      input.store.listTasks(),
      input.store.listActiveMembers(),
      input.store.listRecentMessages(input.conversationId, 40),
    ]);
    const brief = formatProjectBrief({
      tasks,
      members,
      recentMessages: recent,
      connections: connectionFacts(input.env),
    });
    if (command.kind === "brief") return brief;
    const refreshed = await syncPinnedStatus({
      store: input.store,
      conversationId: input.conversationId,
      chatId: input.chatId,
      threadId: input.threadId,
      env: input.env,
      botUserId: input.botUserId,
    });
    return refreshed?.note ? `${brief}\n\n${refreshed.note}` : brief;
  }
  if (command.kind === "approve") {
    if (!input.memberId) return "Не могу подтвердить: отправитель не из списка участников.";
    try {
      const result = await approvePendingAssignment(input.store, command.approvalId, input.memberId);
      const approval = result.approval as { id?: string; status?: string };
      await syncPinnedStatus({
        store: input.store,
        conversationId: input.conversationId,
        chatId: input.chatId,
        threadId: input.threadId,
        env: input.env,
        botUserId: input.botUserId,
      });
      return `Предложение подтверждено. Задача записана. id ${approval.id ?? command.approvalId}.`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "approval_failed";
      if (message.includes("not found")) return "Не удалось подтвердить: такого предложения нет.";
      if (message.includes("not pending")) return "Не удалось подтвердить: это предложение уже обработано.";
      return "Не удалось подтвердить: проверьте id предложения.";
    }
  }
  const [tasks, decisions, topics, messages] = await Promise.all([
    input.store.listTasks(),
    input.store.listDecisions(),
    input.store.listTopics(),
    input.store.listRecentMessages(input.conversationId, 40),
  ]);
  const lastAi = [...messages].reverse().find((message) => message.metadata.usage);
  const lastError = [...messages]
    .reverse()
    .find(
      (message) =>
        message.metadata.agent_state === "completed" &&
        !message.metadata.provider &&
        message.body.includes("OpenRouter"),
    );
  return formatStatusReply({
    provider: input.facts.providerLabel ?? "не задан",
    model: input.facts.model ?? "не задана",
    ai: input.facts.ai,
    telegram: input.facts.telegramConfigured,
    persistence: true,
    activeTopics: topics.filter((topic) => topic.status === "active").length,
    github: input.facts.github,
    activeTasks: tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length,
    confirmedDecisions: decisions.filter((decision) => decision.status === "confirmed").length,
    lastAiAt: lastAi?.occurred_at ?? null,
    lastError: lastError ? "последний AI-запрос не выполнен" : null,
  });
}

async function loadSnapshot(store: TeamAgentStore, env: NodeJS.ProcessEnv) {
  const [tasks, members] = await Promise.all([store.listTasks(), store.listActiveMembers()]);
  return observeProject(env, {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      branchName: task.branch_name,
      assignedMemberId: task.assigned_member_id,
      scopePaths: task.scope_paths,
    })),
    members: members.map((member) => ({ id: member.id, displayName: member.display_name })),
  });
}

async function quietReply(input: {
  store: TeamAgentStore;
  text: string;
  member: import("../types").TeamAgentMember | null;
  conversationId: string;
}): Promise<{ text: string; changed: boolean; taskId: string | null } | null> {
  const [members, messages, tasks] = await Promise.all([
    input.store.listActiveMembers(),
    input.store.listRecentMessages(input.conversationId, 40),
    input.store.listTasks(),
  ]);
  const quoted = quotePartnerSpeech(input.text, messages, members);
  if (quoted) return { text: quoted, changed: false, taskId: null };
  const result = await runTaskIntent({
    store: input.store,
    text: input.text,
    member: input.member,
    tasks,
    members,
  });
  if (!result) return null;
  const changed = /Записал предложение|Подтвердил задачу|теперь в работе|отмечена выполненной/.test(result.text);
  return { text: result.text, changed, taskId: result.taskId };
}

function threadFrom(metadata: Record<string, unknown> | undefined): number | null {
  const value = metadata?.telegram_thread_id;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function syncPinnedStatus(input: {
  store: TeamAgentStore;
  conversationId: string;
  chatId: string;
  threadId: number | null;
  env: NodeJS.ProcessEnv;
  botUserId: number | null;
}) {
  try {
    return await refreshPinnedProjectStatus({
      store: input.store,
      conversationId: input.conversationId,
      threadId: input.threadId,
      env: input.env,
      transport: pinTransport(input.chatId, input.threadId, input.env, input.botUserId),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        error_type: "project_status",
        stage: "persist",
        exception_name: err instanceof Error ? err.name : "Error",
        exception_message: err instanceof Error ? err.message.slice(0, 180) : "status_failed",
        timestamp: new Date().toISOString(),
      }),
    );
    return null;
  }
}

function pinTransport(
  chatId: string,
  threadId: number | null,
  env: NodeJS.ProcessEnv,
  botUserId: number | null,
) {
  return {
    async send(text: string) {
      const sent = await telegramSendMessage({ chatId, text, messageThreadId: threadId, env });
      if (!sent.ok || typeof sent.result.message_id !== "number") {
        return { ok: false as const, error: sent.ok ? "no_message_id" : sent.error };
      }
      return { ok: true as const, messageId: sent.result.message_id };
    },
    async edit(messageId: number, text: string) {
      const edited = await telegramEditMessageText({ chatId, messageId, text, env });
      return edited.ok ? { ok: true as const } : { ok: false as const, error: edited.error };
    },
    async pin(messageId: number) {
      const pinned = await telegramPinChatMessage({ chatId, messageId, env });
      return pinned.ok ? { ok: true as const } : { ok: false as const, error: pinned.error };
    },
    async canPin() {
      let userId = botUserId;
      if (!userId) {
        const me = await telegramGetMe(env);
        userId = me.ok ? me.result.id : null;
      }
      if (!userId) return false;
      const member = await telegramGetChatMember({ chatId, userId, env });
      return member.ok && canPinMessages(member.result);
    },
  };
}

async function sendReply(
  chatId: string,
  text: string,
  replyTo: string,
  env: NodeJS.ProcessEnv,
  threadId?: number | null,
): Promise<{ ok: boolean; error?: string; ids: number[] }> {
  const chunks = splitTelegramText(text);
  const ids: number[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const send = await telegramSendMessage({
      chatId,
      text: chunk,
      replyToMessageId: index === 0 ? Number(replyTo) || null : null,
      messageThreadId: threadId,
      env,
    });
    if (!send.ok) return { ok: false, error: send.error, ids };
    if (typeof send.result.message_id === "number") ids.push(send.result.message_id);
  }
  return { ok: true, ids };
}
