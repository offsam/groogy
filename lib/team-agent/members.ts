/**
 * Bootstrap template for three team members.
 * Real Telegram IDs / secrets must NOT be committed — fill after Telegram connect.
 */

import type { InMemoryTeamAgentStore } from "./store";
import type { TeamAgentMember } from "./types";

export type MemberBootstrapTemplate = {
  key: "sam" | "member_2" | "member_3";
  display_name: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  github_username: string | null;
  role_title: string | null;
  responsibilities: string[];
  skills: string[];
  working_preferences: string | null;
};

/**
 * Example only. Replace TODO fields locally (env / private seed), never commit secrets.
 */
export const TEAM_MEMBER_BOOTSTRAP_TEMPLATE: MemberBootstrapTemplate[] = [
  {
    key: "sam",
    display_name: "Sam",
    telegram_user_id: null, // TODO: set after Telegram connect
    telegram_username: null, // TODO
    github_username: null, // TODO
    role_title: "партнёр, участник разработки",
    responsibilities: ["разработка", "team agent"],
    skills: ["product", "architecture"],
    working_preferences: null,
  },
  {
    key: "member_2",
    display_name: "Member 2",
    telegram_user_id: null, // TODO
    telegram_username: null, // TODO
    github_username: null, // TODO
    role_title: "партнёр, участник разработки",
    responsibilities: ["lib", "supabase/migrations", "api"],
    skills: ["typescript", "supabase", "sql"],
    working_preferences: null,
  },
  {
    key: "member_3",
    display_name: "Member 3",
    telegram_user_id: null, // TODO
    telegram_username: null, // TODO
    github_username: null, // TODO
    role_title: "партнёр, участник разработки",
    responsibilities: ["app", "components", "ui"],
    skills: ["react", "nextjs", "css"],
    working_preferences: null,
  },
];

export function seedMembersFromTemplate(
  store: InMemoryTeamAgentStore,
  templates: MemberBootstrapTemplate[] = TEAM_MEMBER_BOOTSTRAP_TEMPLATE,
  overrides?: Partial<Record<MemberBootstrapTemplate["key"], Partial<MemberBootstrapTemplate>>>,
): TeamAgentMember[] {
  return templates.map((t) => {
    const o = overrides?.[t.key] ?? {};
    const merged = { ...t, ...o };
    return store.upsertMember({
      display_name: merged.display_name,
      telegram_user_id: merged.telegram_user_id,
      telegram_username: merged.telegram_username,
      github_username: merged.github_username,
      role_title: merged.role_title,
      responsibilities: merged.responsibilities,
      skills: merged.skills,
      working_preferences: merged.working_preferences,
      is_active: true,
    });
  });
}

/**
 * How to wire real identities after Telegram Bot is connected:
 * 1. Add TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_CHAT_ID to server env (not git).
 * 2. Have each teammate write once in the allowed group.
 * 3. Read telegram_user_id from ingest metadata / Bot API getUpdates.
 * 4. Upsert team_agent_members with telegram_user_id (stable) + optional username.
 * 5. Set github_username for future GitHub matching.
 * Never commit real IDs if the repo is shared beyond the team.
 */
