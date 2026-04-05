type Diff = {
  file: string
  status?: "added" | "modified" | "deleted"
  before?: string
  after?: string
}

type Open = {
  status: string
  content: string
}

type Check = {
  id: string
  title: string
  command: string
}

type Recent = {
  command: string
  title: string
}

export const getFirstLine = (value: string | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim()
  if (!text) return
  return text.length > 220 ? `${text.slice(0, 219).trimEnd()}...` : text
}

export const getAssistantSummary = (
  parts: { type: string; text?: string; synthetic?: boolean; ignored?: boolean }[],
) => {
  const text = parts
    .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored && part.text ? [part.text] : []))
    .join("\n")
    .trim()

  if (!text) return
  const paragraph = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => !!part)
  return getFirstLine(paragraph ?? text)
}

export const getDiffKind = (diff: Diff) => {
  if (diff.status) return diff.status
  if (!diff.before && diff.after) return "added" as const
  if (diff.before && !diff.after) return "deleted" as const
  return "modified" as const
}

export const getHandoffFlags = (diffs: Diff[]) => {
  const files = diffs.map((item) => item.file)
  const config = files.some((file) =>
    /(^|\/)(package\.json|pnpm-lock\.yaml|bun\.lockb?|tsconfig.*\.json|eslint.*|prettier.*|vite\.config.*|vitest\.config.*|playwright\.config.*|turbo\.json|tailwind\.config.*|ax-code\.json)$/i.test(
      file,
    ),
  )
  const deleted = diffs.some((diff) => getDiffKind(diff) === "deleted")
  const added = diffs.some((diff) => getDiffKind(diff) === "added")
  return { config, deleted, added }
}

export const getHandoffOpen = (items: Open[]) =>
  items
    .filter((item) => item.status !== "completed" && item.status !== "cancelled")
    .map((item) => item.content.trim())
    .filter((item) => !!item)

export const getHandoffChecks = (recent: Recent[], checks: Check[] | undefined) => {
  const seen = new Set<string>()
  const out: { id: string; title: string; command: string; recent?: boolean }[] = []

  for (const item of recent) {
    const cmd = item.command.trim()
    if (!cmd || seen.has(cmd)) continue
    seen.add(cmd)
    out.push({
      id: `recent:${cmd}`,
      title: item.title,
      command: cmd,
      recent: true,
    })
  }

  for (const item of checks ?? []) {
    const cmd = item.command.trim()
    if (!cmd || seen.has(cmd)) continue
    seen.add(cmd)
    out.push({
      id: item.id,
      title: item.title,
      command: cmd,
    })
  }

  return out.slice(0, 4)
}

export const getHandoffRisks = (
  open: string[],
  flags: ReturnType<typeof getHandoffFlags>,
  t: (key: string) => string,
) => {
  const out = [...open]

  if (flags.deleted) out.push(t("session.handoff.open.deleted"))
  if (flags.config) out.push(t("session.handoff.open.config"))
  if (out.length === 0 && flags.added) out.push(t("session.handoff.open.added"))
  if (out.length === 0) out.push(t("session.handoff.open.generic"))

  return [...new Set(out)].slice(0, 3)
}

export const getHandoffSteps = (
  flags: ReturnType<typeof getHandoffFlags>,
  checks: ReturnType<typeof getHandoffChecks>,
  t: (key: string, vars?: Record<string, string | number | boolean>) => string,
) => {
  const out = []

  out.push(t("session.handoff.verify.review"))
  if (flags.deleted) out.push(t("session.handoff.verify.deleted"))
  if (flags.config) out.push(t("session.handoff.verify.config"))
  if (checks.length > 0) {
    out.push(...checks.slice(0, 2).map((item) => t("session.handoff.verify.command", { command: item.command })))
  } else {
    out.push(t("session.handoff.verify.checks"))
  }

  return [...new Set(out)].slice(0, 3)
}

export const getHandoffText = (input: {
  eyebrow: string
  title: string
  summary?: string
  stats: string
  openTitle: string
  risks: string[]
  verifyTitle: string
  steps: string[]
}) =>
  [
    `${input.eyebrow}: ${input.title}`,
    input.summary,
    input.stats,
    `${input.openTitle}:`,
    ...input.risks.map((item) => `- ${item}`),
    `${input.verifyTitle}:`,
    ...input.steps.map((item) => `- ${item}`),
  ]
    .filter((item): item is string => !!item)
    .join("\n")
