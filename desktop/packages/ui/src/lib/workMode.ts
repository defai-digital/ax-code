/**
 * Work mode: Agent (default) | Council | Arena — Qoder-style send routing.
 *
 * Re-exports from core `ax-code/mode/work-mode` with desktop-friendly flat names.
 * Desktop-specific helpers (resolveWorkModeSend, workModeFallbackPrompt) live here.
 */

import { WorkMode } from "ax-code/mode/work-mode"

// ── Re-exports from core ────────────────────────────────────────────────
export type WorkModeId = WorkMode.Id
export const WORK_MODES: readonly WorkModeId[] = WorkMode.ALL
export const DEFAULT_WORK_MODE: WorkModeId = WorkMode.DEFAULT
export const isWorkMode: (value: unknown) => value is WorkModeId = WorkMode.isWorkMode
export const parseWorkMode: (value: unknown, fallback?: WorkModeId) => WorkModeId = WorkMode.parse
export const cycleWorkMode: (current: WorkModeId) => WorkModeId = WorkMode.cycle
export const workModeChipColorHex: (mode: WorkModeId) => `#${string}` = WorkMode.chipColorHex
export type WorkModeRouted = WorkMode.Routed
export const routeWorkModeInput: (mode: WorkModeId, text: string) => WorkModeRouted = WorkMode.routeInput

// ── Desktop-specific helpers ────────────────────────────────────────────

/**
 * Resolve send content through work mode + slash detection.
 * Shared by routeMessage so leading whitespace cannot bypass slash/work-mode routing.
 */
export function resolveWorkModeSend(
  mode: WorkModeId,
  content: string,
): {
  content: string
  forcedCommand: { name: "council" | "arena"; arguments: string } | null
} {
  const routed = routeWorkModeInput(mode, content)
  if (routed.kind === "command") {
    return {
      content: `/${routed.command} ${routed.arguments}`.trimEnd(),
      forcedCommand: { name: routed.command, arguments: routed.arguments },
    }
  }
  // Explicit slash (possibly after leading whitespace) — use normalized text.
  if (routed.text.trimStart().startsWith("/")) {
    return { content: routed.text, forcedCommand: null }
  }
  return { content: routed.text, forcedCommand: null }
}

/**
 * Free-text fallback when Desktop work mode forces council/arena but the connected
 * CLI does not expose that slash command (version skew). Mirrors the built-in
 * command templates so the model still invokes the ensemble tool.
 */
export function workModeFallbackPrompt(command: "council" | "arena", args: string): string {
  if (command === "council") {
    return [
      "Run a multi-provider council review (advisory). Use the **council** tool **as the primary action**.",
      "",
      `Question / focus: ${args}`,
      "",
      "Call the **council** tool within the first 1–2 tool rounds. Do not start with task_parallel monorepo digs.",
      "After council returns, summarize consensus / majority / minority / singleton honestly.",
    ].join("\n")
  }
  return [
    "Run a multi-provider arena (best-of-N). Use the **arena** tool.",
    "",
    `Task: ${args}`,
    "",
    "Call **arena** within the first 1–2 tool rounds. Do not start with task_parallel monorepo digs.",
    "Present ranked results honestly. Never fabricate multi-model output.",
  ].join("\n")
}
