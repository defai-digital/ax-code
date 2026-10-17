import path from "node:path"
import { isInteractivePermission } from "./interaction"
import { classify } from "./risk-classes"
import { bashAutoAcceptTargets } from "./bash-auto-accept"

const INCLUDED = new Set(["edit", "write", "apply_patch", "multiedit", "bash"])

export function autoAcceptEnabled(input: {
  configured?: boolean
  override?: boolean
  managedDisabled?: boolean
}): boolean {
  return input.managedDisabled !== true && (input.override ?? input.configured ?? false)
}

/** Pure, tightening-only admission after ordinary rules and guardian checks. */
export function shouldAutoAccept(input: {
  enabled?: boolean
  managedDisabled?: boolean
  permission: string
  patterns: readonly string[]
  paths?: readonly string[]
  directory: string
  protectedPaths?: string[]
  interactiveOnly?: boolean
  metadata?: Record<string, unknown>
  riskClass?: string
  risk?: string
  denied?: boolean
  managedRule?: boolean
  /**
   * SafetyPolicy.decide, injected by the caller. It is not imported here because
   * control-plane/safety-policy reaches session/index.ts, which would close an
   * import cycle with permission/index.ts. Without it nothing is auto-accepted.
   */
  decide?: (input: { permission: string; paths: string[]; protectedPaths?: string[] }) => {
    action: string
    risk?: string
  }
}): boolean {
  if (!input.decide) return false
  if (!input.enabled || input.managedDisabled || input.denied || input.managedRule || !INCLUDED.has(input.permission))
    return false
  if (input.interactiveOnly || isInteractivePermission(input.permission, input.metadata)) return false
  const permission = input.permission === "bash" ? "bash" : "edit"
  const riskClass = input.riskClass ?? classify(permission)
  if (riskClass !== "safe" && riskClass !== "risk") return false
  if (input.risk && !["safe", "low", "medium"].includes(input.risk)) return false
  if (input.patterns.length === 0) return false

  const candidates = autoAcceptTargets(input)
  if (!candidates?.length) return false
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith("-")) continue
    // See bash-auto-accept: a parent reference is normalised before symlinks are inspected.
    if (candidate.replaceAll("\\", "/").split("/").includes("..")) return false
    if (candidate.startsWith("~") || candidate.includes("://") || /[*?\[\]]/.test(candidate)) return false
    const normalized = path.resolve(input.directory, candidate.replaceAll("\\", "/"))
    const relative = path.relative(input.directory, normalized).replaceAll("\\", "/")
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) return false
    // Keep the default protected/blocked lists even when extra lists are supplied.
    for (const protectedPaths of [undefined, input.protectedPaths]) {
      const decision = input.decide({ permission, paths: [relative, normalized], protectedPaths })
      if (decision.action === "deny" || decision.risk === "high" || decision.risk === "blocked") return false
    }
  }
  return true
}

/** Targets to canonicalize before admission; undefined means shell expansion is uncertain. */
export function autoAcceptTargets(input: {
  permission: string
  patterns: readonly string[]
  paths?: readonly string[]
  metadata?: Record<string, unknown>
}): string[] | undefined {
  if (input.permission === "bash") {
    const targets = bashAutoAcceptTargets(input.metadata)
    return targets ? [...targets, ...(input.paths ?? [])] : undefined
  }
  const candidates = [...(input.paths ?? [])]
  for (const pattern of input.patterns) {
    candidates.push(pattern)
  }
  return candidates
    .map((candidate) =>
      candidate.startsWith("-") && candidate.includes("=") ? candidate.slice(candidate.indexOf("=") + 1) : candidate,
    )
    .filter((candidate) => candidate.length > 0 && !candidate.startsWith("-"))
}
