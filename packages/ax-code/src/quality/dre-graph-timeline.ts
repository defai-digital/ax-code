import type { SessionDre } from "../session/dre"

export type DreGraphTimelineToolEntry = {
  name: string
  args: string
  status: string
  durationMs: number
}

export type DreGraphTimelineStep = {
  index: string
  duration: string
  tokens: string
  tools: DreGraphTimelineToolEntry[]
  routes: string[]
  errors: string[]
  llms: string[]
}

export type DreGraphTimeline = {
  header: SessionDre.TimelineLine | undefined
  meta: SessionDre.TimelineLine[]
  steps: DreGraphTimelineStep[]
}

export function parseDreGraphTimeline(lines: SessionDre.TimelineLine[]): DreGraphTimeline {
  const header = lines.find((line) => line.kind === "heading")
  const meta = lines.filter((line) => line.kind === "meta")
  const steps: DreGraphTimelineStep[] = []
  let current: DreGraphTimelineStep | undefined

  for (const line of lines) {
    if (line.kind === "step") {
      const parts = line.text.split(" · ")
      current = {
        index: parts[0] ?? "",
        duration: parts[1] ?? "",
        tokens: parts[2] ?? "",
        tools: [],
        routes: [],
        errors: [],
        llms: [],
      }
      steps.push(current)
      continue
    }

    if (!current) continue

    if (line.kind === "tool") {
      current.tools.push(parseDreGraphTimelineTool(line.text))
    } else if (line.kind === "route") {
      current.routes.push(line.text)
    } else if (line.kind === "error") {
      current.errors.push(line.text)
    } else if (line.kind === "llm") {
      current.llms.push(line.text)
    }
  }

  return { header, meta, steps }
}

export function parseDreGraphTimelineStepDurationMs(value: string): number {
  const match = value.match(/(?:(\d+)m\s*)?(\d+)s/)
  if (!match) return 0
  const minutes = Number.parseInt(match[1] ?? "0", 10)
  const seconds = Number.parseInt(match[2] ?? "0", 10)
  return (minutes * 60 + seconds) * 1000
}

function parseDreGraphTimelineTool(text: string): DreGraphTimelineToolEntry {
  const withArgs = text.match(/^(\S+?):\s*(.*?)\s*→\s*(\S+)\s*(?:\((\d+)ms\))?$/)
  if (withArgs) {
    return {
      name: withArgs[1] ?? "",
      args: withArgs[2] ?? "",
      status: withArgs[3] ?? "",
      durationMs: parseDreGraphTimelineToolDurationMs(withArgs[4]),
    }
  }

  const bare = text.match(/^(\S+)\s*→\s*(\S+)\s*(?:\((\d+)ms\))?$/)
  if (bare) {
    return {
      name: bare[1] ?? "",
      args: "",
      status: bare[2] ?? "",
      durationMs: parseDreGraphTimelineToolDurationMs(bare[3]),
    }
  }

  return { name: text, args: "", status: "ok", durationMs: 0 }
}

function parseDreGraphTimelineToolDurationMs(raw: string | undefined): number {
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? 0 : Math.max(0, parsed)
}
