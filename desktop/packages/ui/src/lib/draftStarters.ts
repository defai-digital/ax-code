import type { IconName } from "@/components/icon/icons"
import type { I18nKey } from "@/lib/i18n"

// A draft starter is a reference to an existing command or skill, pinned to the
// onboarding/draft welcome screen as a one-click chip. Scope (global vs project)
// is NOT stored here — it is encoded by which list the ref lives in (global =
// settings.json, project = project config), derived from the command/skill's own
// scope when pinned.
export type DraftStarterType = "command" | "skill"

export type DraftStarterRef = {
  type: DraftStarterType
  name: string
}

// Our built-in openchamber commands (Session magic prompts). They are always
// available to pin, keep their bespoke icons, and seed the default global set.
export type BuiltInStarter = {
  name: string
  icon: IconName
  labelKey: I18nKey
  command: string
}

export const BUILTIN_STARTERS: readonly BuiltInStarter[] = [
  { name: "explore", icon: "compass-3", labelKey: "chat.draftPresets.explore.label", command: "/explore" },
  { name: "catch-up", icon: "history", labelKey: "chat.draftPresets.catchup.label", command: "/catch-up" },
  { name: "weigh", icon: "scales-3", labelKey: "chat.draftPresets.weigh.label", command: "/weigh" },
  { name: "plan-feature", icon: "survey", labelKey: "chat.draftPresets.plan.label", command: "/plan" },
  { name: "debug", icon: "bug", labelKey: "chat.draftPresets.debug.label", command: "/debug" },
  { name: "review", icon: "search-eye", labelKey: "chat.draftPresets.review.label", command: "/review" },
  {
    name: "summarise",
    icon: "code-ai",
    labelKey: "chat.draftPresets.summarise.label",
    command: "Summarise this codebase and explain the main architecture",
  },
  {
    name: "find-bugs",
    icon: "git-commit",
    labelKey: "chat.draftPresets.findBugs.label",
    command: "Find bugs or issues in the recent git commits",
  },
  {
    name: "write-tests",
    icon: "file-check",
    labelKey: "chat.draftPresets.writeTests.label",
    command: "Write tests for the recently changed files",
  },
]

const BUILTIN_BY_NAME = new Map<string, BuiltInStarter>(BUILTIN_STARTERS.map((s) => [s.name, s]))

export const getBuiltInStarter = (name: string): BuiltInStarter | undefined => BUILTIN_BY_NAME.get(name)
export const isBuiltInStarter = (ref: DraftStarterRef): boolean =>
  ref.type === "command" && BUILTIN_BY_NAME.has(ref.name)

// Default global starter set (used until the user customizes the global list).
export const DEFAULT_GLOBAL_STARTERS: readonly DraftStarterRef[] = BUILTIN_STARTERS.map((s) => ({
  type: "command" as const,
  name: s.name,
}))

/**
 * Work-surface starters — daily agentic tasks (not codebase workflows).
 * Shown when the desktop surface is "work" instead of the code-oriented set.
 * submit text is free-form so it works without coding slash commands.
 */
export const WORK_BUILTIN_STARTERS: readonly BuiltInStarter[] = [
  {
    name: "work-plan-day",
    icon: "calendar-schedule",
    labelKey: "chat.draftPresets.work.planDay.label",
    command:
      "Help me plan today: prioritize open tasks, block focus time, and list the top 3 outcomes I should hit.",
  },
  {
    name: "work-draft-message",
    icon: "edit-2",
    labelKey: "chat.draftPresets.work.draftMessage.label",
    command:
      "Draft a clear, professional message or email. Ask me for the audience and goal if needed, then produce a ready-to-send version.",
  },
  {
    name: "work-research",
    icon: "global",
    labelKey: "chat.draftPresets.work.research.label",
    command:
      "Research this topic thoroughly, cite sources where possible, and give me a concise brief with recommendations.",
  },
  {
    name: "work-summarize",
    icon: "file-text",
    labelKey: "chat.draftPresets.work.summarize.label",
    command:
      "Summarize the key points from my notes or files into decisions, risks, and action items.",
  },
  {
    name: "work-meeting",
    icon: "chat-3",
    labelKey: "chat.draftPresets.work.meeting.label",
    command:
      "Prepare a meeting agenda: goals, talking points, time boxes, and questions I should ask.",
  },
  {
    name: "work-follow-up",
    icon: "send-plane",
    labelKey: "chat.draftPresets.work.followUp.label",
    command:
      "Turn these notes into clear follow-ups: owners, due dates if known, and a short status update I can send.",
  },
  {
    name: "work-prioritize",
    icon: "list-check-2",
    labelKey: "chat.draftPresets.work.prioritize.label",
    command:
      "Help me prioritize my task list by impact and urgency. Flag blockers and suggest what to do next.",
  },
  {
    name: "work-automate",
    icon: "robot",
    labelKey: "chat.draftPresets.work.automate.label",
    command:
      "Propose a small automation for a repetitive daily workflow. Prefer safe, reversible steps and a short checklist.",
  },
  {
    name: "work-agent-task",
    icon: "sparkling",
    labelKey: "chat.draftPresets.work.agentTask.label",
    command:
      "Act as an autonomous agent: break the goal into steps, use tools when needed, and keep going until the outcome is done or blocked.",
  },
]

const WORK_BUILTIN_BY_NAME = new Map<string, BuiltInStarter>(WORK_BUILTIN_STARTERS.map((s) => [s.name, s]))

export const DEFAULT_WORK_STARTERS: readonly DraftStarterRef[] = WORK_BUILTIN_STARTERS.map((s) => ({
  type: "command" as const,
  name: s.name,
}))

export const getWorkBuiltInStarter = (name: string): BuiltInStarter | undefined => WORK_BUILTIN_BY_NAME.get(name)

export const isWorkBuiltInStarter = (ref: DraftStarterRef): boolean =>
  ref.type === "command" && WORK_BUILTIN_BY_NAME.has(ref.name)

// Fallback icons for user-defined starters, matching the Settings sections.
export const COMMAND_FALLBACK_ICON: IconName = "terminal-box"
export const SKILL_FALLBACK_ICON: IconName = "book-open"

export const starterKey = (ref: DraftStarterRef): string => `${ref.type}:${ref.name}`

export const sameStarter = (a: DraftStarterRef, b: DraftStarterRef): boolean => a.type === b.type && a.name === b.name

// Turn a command/skill name into a human chip label: "/simplify-code" -> "Simplify code".
export const normalizeStarterLabel = (name: string): string => {
  const base = name.replace(/^\//, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  if (!base) return name
  return base.charAt(0).toUpperCase() + base.slice(1)
}

// Parse persisted starter refs (from settings.json or project config) defensively.
export const sanitizeStarterRefs = (value: unknown): DraftStarterRef[] => {
  if (!Array.isArray(value)) return []
  const out: DraftStarterRef[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const type = record.type === "command" || record.type === "skill" ? record.type : null
    const name = typeof record.name === "string" ? record.name.trim() : ""
    if (!type || !name) continue
    const key = `${type}:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type, name })
  }
  return out
}
