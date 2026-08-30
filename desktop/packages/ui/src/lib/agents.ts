/**
 * Agent helpers — pure functions and the agents-source bridge.
 *
 * The agents domain has a single home: `useAgentsStore`
 * (SPEC-2026-08-30-desktop-state-convergence, D2/§3). The pure helpers live
 * here (not in the store) so modules that must not import a sibling store —
 * per the R1 store→store import ratchet in
 * `script/check-desktop-store-boundaries.ts` — can still filter agent lists.
 *
 * The `AgentsSource` registry below is the bridge for the same constraint:
 * `useAgentsStore` registers itself at module load, and `useConfigStore`
 * (which may not import the agents store) reads/loads the list through it.
 */

import type { Agent } from "@ax-code/sdk/v2"

export type AgentScope = "user" | "project"

// Extended Agent type for API properties not in SDK types
export type AgentWithExtras = Agent & {
  native?: boolean
  hidden?: boolean
  options?: { hidden?: boolean }
  scope?: AgentScope
  /** Subfolder name parsed from file path, e.g. "business", "development" */
  group?: string
}

// Helper to check if agent is built-in (handles both SDK 'builtIn' and API 'native')
export const isAgentBuiltIn = (agent: Agent): boolean => {
  const extended = agent as AgentWithExtras & { builtIn?: boolean }
  return extended.native === true || extended.builtIn === true
}

// Helper to check if agent is hidden (internal agents like title, compaction, summary)
// Checks both top-level hidden and options.hidden (AX Code API inconsistency workaround)
export const isAgentHidden = (agent: Agent): boolean => {
  const extended = agent as AgentWithExtras
  return extended.hidden === true || extended.options?.hidden === true
}

// Helper to filter only visible (non-hidden) agents
export const filterVisibleAgents = (agents: Agent[]): Agent[] => agents.filter((agent) => !isAgentHidden(agent))

/**
 * Access point to the single agents home without a store→store import edge.
 * Registered by `useAgentsStore` at module load; consumers tolerate a null
 * source (treated as "no agents loaded yet").
 */
export type AgentsSource = {
  getAgents: () => Agent[]
  loadAgents: (options?: { directory?: string | null }) => Promise<boolean>
}

let agentsSource: AgentsSource | null = null

export function registerAgentsSource(source: AgentsSource): void {
  agentsSource = source
}

export function getAgentsSource(): AgentsSource | null {
  return agentsSource
}
