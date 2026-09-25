/**
 * Picks mock or OpenAI from TEAM_AGENT_PROVIDER. Tests inject a provider instead.
 */

import { MockTeamAgentProvider, type TeamAgentProvider } from "./agent-provider";
import { loadTeamAgentConfig } from "./config";
import { OpenAITeamAgentProvider } from "./openai-provider";

export function createTeamAgentProvider(
  env: NodeJS.ProcessEnv = process.env,
): TeamAgentProvider {
  const config = loadTeamAgentConfig(env);
  if (config.provider === "openai") {
    return new OpenAITeamAgentProvider({ env });
  }
  return new MockTeamAgentProvider();
}
