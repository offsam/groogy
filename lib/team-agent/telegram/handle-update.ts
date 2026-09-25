/**
 * Telegram update → ingest → optional agent reply.
 * Production path uses Supabase store; tests inject InMemory.
 */

import { randomUUID } from "node:crypto";
import { consumeAiBudget } from "../ai-budget";
import type { TeamAgentProvider } from "../agent-provider";
import { approvePendingAssignment, executeValidatedAction } from "../actions";
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
import { TeamAgentModelError, publicFailureText } from "../openai-provider";
import { createTeamAgentProvider } from "../provider-factory";
import type { TeamAgentStore } from "../store-port";
import { linkMessageToTopics } from "../topics";
import {
  DeterministicTopicClassifier,
  resolveInvocationTopics,
  type TopicClassifier,
} from "../topic-classifier";
import { splitTelegramText, telegramSendMessage } from "./bot-api";
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

  const requestId = randomUUID();
  const local = parseLocalCommand(ingest.message.body, config.botUsername);
  const githubReady = Boolean(githubConfigFromEnv(env));
  if (local && !(local.kind === "github_unavailable" && githubReady)) {
    const text = await localReply(local, {
      store: input.store,
      env,
    memberId: ingest.member?.id ?? null,
    conversationId: ingest.conversation.id,
    facts: capabilityFacts(env, config),
    observe: input.observe,
    });
    const sent = await sendReply(normalized.ingest.conversationExternalId, text, normalized.ingest.messageExternalId, env);
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

  if (!input.provider) {
    const budget = consumeAiBudget();
    if (!budget.ok) {
      const text = "Слишком много запросов к AI подряд. Подождите несколько минут.";
      await sendReply(normalized.ingest.conversationExternalId, text, normalized.ingest.messageExternalId, env);
      return {
        status: "ingested",
        reason: "ai_budget",
        shouldRespond: true,
        replySent: true,
        providerCalls: 0,
        stored: true,
      };
    }
  }

  const claim = await claimAgentReply(input.store, {
    conversationId: ingest.conversation.id,
    triggerMessage: ingest.message,
    requestId,
  });
  if (!claim.claimed) {
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

  let providerCalls = 0;
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

    const canApplyActions =
      Boolean(ingest.member) || Boolean(input.allowUnknownPrivilegedActions);
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

    const notes: string[] = [];
    if (canApplyActions) {
      for (const action of reply.proposedActions) {
        const executed = await executeValidatedAction(input.store, action);
        notes.push(...actionNote(action.type, executed));
        const result = executed.result as { id?: string } | null;
        if (!result?.id || selectedTopicIds.length === 0) continue;
        if (action.type === "create_task") {
          for (const topicId of selectedTopicIds) {
            await input.store.linkSubjectToTopic({ topicId, taskId: result.id });
          }
        }
        if (action.type === "record_decision") {
          for (const topicId of selectedTopicIds) {
            await input.store.linkSubjectToTopic({ topicId, decisionId: result.id });
          }
        }
        if (action.type === "record_memory") {
          for (const topicId of selectedTopicIds) {
            await input.store.linkSubjectToTopic({ topicId, memoryId: result.id });
          }
        }
      }
    } else if (reply.proposedActions.length) {
      notes.push("Ничего не записано: отправитель не из списка участников.");
    }

    const replyText = [reply.replyText, ...notes].filter(Boolean).join("\n");
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
    const sent = await sendReply(
      normalized.ingest.conversationExternalId,
      replyText,
      normalized.ingest.messageExternalId,
      env,
    );
    if (sent.ids.length && claim.message) {
      await input.store.updateMessage(claim.message.id, {
        metadata: { telegram_message_ids: sent.ids },
      });
    }
    await linkMessageToTopics(input.store, claim.message!.id, selectedTopicIds);
    await markMessageAgentReplied(input.store, ingest.message.id, claim.message!.id);

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
    console.error("[team-agent]", requestId, code);
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
      });
      await markMessageAgentReplied(input.store, ingest.message.id, claim.message.id);
    }
    await sendReply(normalized.ingest.conversationExternalId, text, normalized.ingest.messageExternalId, env);
    return {
      status: "provider_error",
      reason: code,
      shouldRespond: true,
      replySent: false,
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
  if (command.kind === "approve") {
    if (!input.memberId) return "Не могу подтвердить: отправитель не из списка участников.";
    try {
      const result = await approvePendingAssignment(input.store, command.approvalId, input.memberId);
      const approval = result.approval as { id?: string; status?: string };
      return `Подтверждено ${approval.id ?? command.approvalId}. Статус: ${approval.status ?? "approved"}.`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "approval_failed";
      if (message.includes("not found")) return "Такого предложения нет.";
      if (message.includes("not pending")) return "Это предложение уже обработано.";
      return "Не удалось подтвердить это предложение.";
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

function actionNote(
  type: string,
  executed: { applied: boolean; result: unknown; error?: string },
): string[] {
  const result = executed.result as { id?: string; title?: string; status?: string } | null;
  if (!result?.id) return [];
  if (type === "create_task") {
    return [
      `Записано предложение задачи «${result.title ?? result.id}» (статус ${result.status ?? "proposed"}, id ${result.id}). Это ещё не утверждённая работа.`,
    ];
  }
  if (type === "record_decision") {
    return [`Записано предложение решения (id ${result.id}). Оно не подтверждено.`];
  }
  if (type === "assign_task" || type === "propose_assignment_batch") {
    return [`Назначение ждёт подтверждения. Команда: /agent approve ${result.id}`];
  }
  return [];
}

async function sendReply(
  chatId: string,
  text: string,
  replyTo: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; error?: string; ids: number[] }> {
  const chunks = splitTelegramText(text);
  const ids: number[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const send = await telegramSendMessage({
      chatId,
      text: chunk,
      replyToMessageId: index === 0 ? Number(replyTo) || null : null,
      env,
    });
    if (!send.ok) return { ok: false, error: send.error, ids };
    if (typeof send.result.message_id === "number") ids.push(send.result.message_id);
  }
  return { ok: true, ids };
}
