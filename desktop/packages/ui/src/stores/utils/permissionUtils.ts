import type { EditPermissionMode } from "../types/sessionTypes"

const EDIT_PERMISSION_TOOL_NAMES = new Set(["edit", "multiedit", "str_replace", "str_replace_based_edit_tool", "write"])

export const isEditPermissionType = (type?: string | null): boolean => {
  if (!type) {
    return false
  }
  return EDIT_PERMISSION_TOOL_NAMES.has(type.toLowerCase())
}

export type PermissionAction = "allow" | "deny" | "ask"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionConfigValue = PermissionAction | Record<string, PermissionAction>
export type PermissionRuleKey = `${string}::${string}`

export const isPermissionAction = (value: unknown): value is PermissionAction =>
  value === "allow" || value === "ask" || value === "deny"

export const buildPermissionRuleKey = (permission: string, pattern: string): PermissionRuleKey =>
  `${permission}::${pattern}`

export const normalizePermissionRules = (ruleset: PermissionRule[]): PermissionRule[] => {
  const map = new Map<PermissionRuleKey, PermissionRule>()
  for (const rule of ruleset) {
    if (!rule.permission || rule.permission === "invalid") {
      continue
    }
    if (!rule.pattern) {
      continue
    }
    if (!isPermissionAction(rule.action)) {
      continue
    }
    map.set(buildPermissionRuleKey(rule.permission, rule.pattern), {
      permission: rule.permission,
      pattern: rule.pattern,
      action: rule.action,
    })
  }
  return Array.from(map.values())
}

export const parsePermissionRuleset = (ruleset: unknown): PermissionRule[] => {
  if (!Array.isArray(ruleset)) {
    return []
  }

  const parsed: PermissionRule[] = []
  for (const entry of ruleset) {
    if (!entry || typeof entry !== "object") {
      continue
    }
    const candidate = entry as Partial<PermissionRule>
    if (typeof candidate.permission !== "string" || typeof candidate.pattern !== "string") {
      continue
    }
    if (!isPermissionAction(candidate.action)) {
      continue
    }
    parsed.push({
      permission: candidate.permission,
      pattern: candidate.pattern,
      action: candidate.action,
    })
  }
  return parsed
}

type ConfigStoreAgent = {
  name: string
  permission?: PermissionRule[]
}

type ConfigStoreState = {
  agents?: ConfigStoreAgent[]
}

type ConfigStoreRef = { getState?: () => ConfigStoreState }

const resolveConfigStore = (): ConfigStoreRef | undefined => {
  if (typeof window === "undefined") {
    return undefined
  }
  return (window as { __zustand_config_store__?: ConfigStoreRef }).__zustand_config_store__
}

const getAgentDefinition = (agentName?: string): ConfigStoreAgent | undefined => {
  if (!agentName) {
    return undefined
  }

  try {
    const configStore = resolveConfigStore()
    if (configStore?.getState) {
      const state = configStore.getState()
      return state.agents?.find?.((agent) => agent.name === agentName)
    }
  } catch {
    /* ignored */
  }

  return undefined
}

const resolvePermissionAction = (ruleset: PermissionRule[] | undefined, permission: string): PermissionAction => {
  if (!ruleset || ruleset.length === 0) {
    return "ask"
  }

  // Prefer explicit rule for the tool at wildcard pattern.
  for (let index = ruleset.length - 1; index >= 0; index -= 1) {
    const rule = ruleset[index]
    if (rule.permission === permission && rule.pattern === "*") {
      return rule.action
    }
  }

  // Fall back to global wildcard.
  for (let index = ruleset.length - 1; index >= 0; index -= 1) {
    const rule = ruleset[index]
    if (rule.permission === "*" && rule.pattern === "*") {
      return rule.action
    }
  }

  return "ask"
}

export const getAgentDefaultEditPermission = (agentName?: string): EditPermissionMode => {
  const agent = getAgentDefinition(agentName)
  if (!agent) {
    return "ask"
  }

  const action = resolvePermissionAction(agent.permission, "edit")
  return action
}
