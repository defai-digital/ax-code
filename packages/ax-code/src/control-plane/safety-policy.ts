import z from "zod"

import { classify as classifyPermissionRisk } from "../permission/risk-classes"
import { AgentControl } from "./agent-control"

export namespace SafetyPolicy {
  export const Action = z.enum(["allow", "ask", "deny", "allow_with_checkpoint"])
  export type Action = z.infer<typeof Action>

  export const Risk = z.enum(["safe", "low", "medium", "high", "blocked"])
  export type Risk = z.infer<typeof Risk>

  export const Mode = z.enum(["normal", "autonomous"])
  export type Mode = z.infer<typeof Mode>

  export const Decision = z.object({
    action: Action,
    risk: Risk,
    reason: z.string(),
    checkpointRequired: z.boolean(),
    matchedRule: z.string().optional(),
  })
  export type Decision = z.infer<typeof Decision>

  export type BlastRadius = {
    filesChanged?: number
    linesChanged?: number
    maxFiles?: number
    maxLines?: number
  }

  export type Input = {
    mode?: Mode
    phase?: AgentControl.Phase
    permission: string
    tool?: string
    path?: string
    paths?: string[]
    protectedPaths?: string[]
    safePermissions?: readonly string[]
    riskyPermissions?: readonly string[]
    strictUnknown?: boolean
    approvalRequired?: boolean
    blastRadius?: BlastRadius
  }

  const DEFAULT_SAFE_PERMISSIONS = [
    "read",
    "glob",
    "grep",
    "list",
    "list_directory",
    "codesearch",
    "lsp",
    "code_intelligence",
    "skill",
    "todoread",
    "websearch",
  ] as const

  const DEFAULT_RISKY_PERMISSIONS = [
    "edit",
    "write",
    "apply_patch",
    "bash",
    "network",
    "package_install",
    "webfetch",
    "external_directory",
    "task",
    "todowrite",
    "memorywrite",
  ] as const

  const DEFAULT_PROTECTED_PATHS = [
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "secrets",
    "**/secrets",
    "secrets/**",
    "**/secrets/**",
    ".git/hooks",
    "**/.git/hooks",
    ".git/hooks/**",
    "**/.git/hooks/**",
  ] as const

  export function decide(input: Input): Decision {
    const mode = input.mode ?? "normal"
    const protectedMatch = protectedPathMatch(input)
    if (protectedMatch) {
      return {
        action: "deny",
        risk: "blocked",
        reason: "protected_path",
        checkpointRequired: false,
        matchedRule: protectedMatch,
      }
    }

    const blastRadius = blastRadiusDecision(input.blastRadius)
    if (blastRadius) return blastRadius

    if (input.approvalRequired) {
      return {
        action: "ask",
        risk: "high",
        reason: "approval_required",
        checkpointRequired: true,
      }
    }

    const riskClass = permissionRiskClass(input)
    if (riskClass === "safe") {
      return {
        action: "allow",
        risk: "safe",
        reason: "safe_permission",
        checkpointRequired: false,
        matchedRule: input.permission,
      }
    }

    if (riskClass === "risk") {
      if (mode === "autonomous") {
        return {
          action: "ask",
          risk: "high",
          reason: "autonomous_risky_permission",
          checkpointRequired: true,
          matchedRule: input.permission,
        }
      }
      return {
        action: "allow_with_checkpoint",
        risk: "medium",
        reason: "risky_permission",
        checkpointRequired: true,
        matchedRule: input.permission,
      }
    }

    if (input.strictUnknown || mode === "autonomous") {
      return {
        action: "ask",
        risk: "medium",
        reason: "unknown_permission",
        checkpointRequired: true,
        matchedRule: input.permission,
      }
    }

    return {
      action: "allow_with_checkpoint",
      risk: "low",
      reason: "unknown_permission_checkpoint",
      checkpointRequired: true,
      matchedRule: input.permission,
    }
  }

  function permissionRiskClass(input: Input): "safe" | "risk" | "unknown" {
    const defaultClass = classifyPermissionRisk(input.permission)

    if (input.safePermissions) {
      if (input.safePermissions.includes(input.permission)) return "safe"
    } else if (defaultClass === "safe" || includesPermission(DEFAULT_SAFE_PERMISSIONS, input.permission)) {
      return "safe"
    }

    if (input.riskyPermissions) {
      if (input.riskyPermissions.includes(input.permission)) return "risk"
    } else if (defaultClass === "risk" || includesPermission(DEFAULT_RISKY_PERMISSIONS, input.permission)) {
      return "risk"
    }

    return "unknown"
  }

  function includesPermission(permissions: readonly string[], permission: string): boolean {
    return permissions.includes(permission)
  }

  function blastRadiusDecision(input: BlastRadius | undefined): Decision | undefined {
    if (!input) return undefined
    if (input.maxFiles !== undefined && input.filesChanged !== undefined && input.filesChanged > input.maxFiles) {
      return {
        action: "deny",
        risk: "blocked",
        reason: "blast_radius_files_exceeded",
        checkpointRequired: false,
        matchedRule: `files>${input.maxFiles}`,
      }
    }
    if (input.maxLines !== undefined && input.linesChanged !== undefined && input.linesChanged > input.maxLines) {
      return {
        action: "deny",
        risk: "blocked",
        reason: "blast_radius_lines_exceeded",
        checkpointRequired: false,
        matchedRule: `lines>${input.maxLines}`,
      }
    }
    if (
      (input.maxFiles !== undefined && input.filesChanged !== undefined && input.filesChanged === input.maxFiles) ||
      (input.maxLines !== undefined && input.linesChanged !== undefined && input.linesChanged === input.maxLines)
    ) {
      return {
        action: "allow_with_checkpoint",
        risk: "high",
        reason: "blast_radius_at_limit",
        checkpointRequired: true,
      }
    }
    return undefined
  }

  function protectedPathMatch(input: Input): string | undefined {
    const patterns = input.protectedPaths ?? DEFAULT_PROTECTED_PATHS
    const paths = [input.path, ...(input.paths ?? [])].filter((item): item is string => !!item)
    for (const path of paths) {
      const normalized = normalizePath(path)
      for (const pattern of patterns) {
        if (matchPath(normalized, normalizePath(pattern))) return pattern
      }
    }
    return undefined
  }

  function normalizePath(path: string) {
    return path
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
  }

  function matchPath(path: string, pattern: string) {
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3)
      return path === suffix || path.endsWith(`/${suffix}`) || matchGlob(path, pattern)
    }
    return matchGlob(path, pattern)
  }

  function matchGlob(path: string, pattern: string) {
    return new RegExp(`^${globToRegex(pattern)}$`).test(path)
  }

  function globToRegex(pattern: string) {
    let output = ""
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index]
      if (char === "*") {
        if (pattern[index + 1] === "*") {
          output += ".*"
          index++
        } else {
          output += "[^/]*"
        }
        continue
      }
      output += escapeRegex(char)
    }
    return output
  }

  function escapeRegex(value: string) {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
  }
}
