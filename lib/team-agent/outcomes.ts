/**
 * Counts conversational outcomes already stored on bot replies.
 * Does not read message bodies.
 */

export type AgentOutcomeCounts = {
  success: number;
  malformed: number;
  empty: number;
  timeout: number;
  providerError: number;
  rateLimited: number;
  other: number;
};

export function summarizeAgentOutcomes(
  messages: Array<{ message_type: string; metadata: Record<string, unknown> }>,
): AgentOutcomeCounts {
  const counts: AgentOutcomeCounts = {
    success: 0,
    malformed: 0,
    empty: 0,
    timeout: 0,
    providerError: 0,
    rateLimited: 0,
    other: 0,
  };
  for (const message of messages) {
    if (message.message_type !== "bot") continue;
    const errorType = message.metadata.error_type;
    if (typeof errorType !== "string" || !errorType) {
      if (message.metadata.usage) counts.success += 1;
      continue;
    }
    if (errorType === "malformed") counts.malformed += 1;
    else if (errorType === "empty") counts.empty += 1;
    else if (errorType === "timeout") counts.timeout += 1;
    else if (errorType === "rate_limited") counts.rateLimited += 1;
    else if (errorType === "provider_error" || errorType === "request_failed" || errorType === "upstream") {
      counts.providerError += 1;
    } else counts.other += 1;
  }
  return counts;
}
