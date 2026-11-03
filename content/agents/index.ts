import type { Agent, L } from "../types";
import { AGENT_LIST } from "./agents";

/** AI agents that can connect to Muse4AI (R3-AG), in hub order. */
export const AGENTS: Agent[] = [...AGENT_LIST].sort((a, b) => a.rank - b.rank);

export function agent(slug: string): Agent | undefined {
  return AGENTS.find((a) => a.slug === slug);
}

/** Page heading for an agent guide ("Connect Cursor to Muse"). */
export function agentTitle(a: Agent): L {
  return { en: `Connect ${a.name} to Muse`, vi: `Kết nối ${a.name} với Muse` };
}
