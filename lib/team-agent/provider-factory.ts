/**
 * Picks mock, direct OpenAI, or OpenRouter from TEAM_AGENT_PROVIDER.
 */

import { MockTeamAgentProvider, type TeamAgentProvider } from "./agent-provider";
import { loadTeamAgentConfig } from "./config";
import { OpenAITeamAgentProvider } from "./openai-provider";

export function createTeamAgentProvider(
  env: NodeJS.ProcessEnv = process.env,
): TeamAgentProvider {
  const config = loadTeamAgentConfig(env);
  if (config.provider === "openai" || config.provider === "openrouter") {
    return new OpenAITeamAgentProvider({ env });
  }
  return new MockTeamAgentProvider();
}
