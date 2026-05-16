import type { Part, ToolPart } from "@ax-code/sdk/v2"

// Read-only, low-info-per-row tools that are safe to visually fold into
// a single "Read · 5 files" summary. Bash/Edit/Write/Task etc. carry too
// much per-call detail (commands, diffs, subagent threads) to coalesce.
const COALESCE_ELIGIBLE = new Set(["read", "glob", "grep", "list"])

// Minimum consecutive run length before we collapse. 2 is still readable;
// 3 is where transcript fatigue starts.
const COALESCE_MIN = 3

export type DisplayPart =
  | { kind: "single"; part: Part }
  | { kind: "coalesced"; tool: string; parts: ToolPart[]; key: string }

function isCoalesceable(part: Part): part is ToolPart {
  if (part.type !== "tool") return false
  const tool = part as ToolPart
  if (!COALESCE_ELIGIBLE.has(tool.tool)) return false
  // A failed call in the run bursts the whole group — see PRD risk
  // "Coalescing hides errors". Cheaper to check per-part here than to
  // post-process.
  if (tool.state.status === "error") return false
  return true
}

// Walk parts left-to-right, collecting runs of same-tool eligible parts.
// Runs ≥ COALESCE_MIN collapse into a single DisplayPart; anything else
// (including a run of 2, or a mixed-tool sequence) passes through as
// individual singles preserving order.
export function coalesceParts(parts: Part[]): DisplayPart[] {
  const out: DisplayPart[] = []
  let i = 0
  while (i < parts.length) {
    const part = parts[i]
    if (!isCoalesceable(part)) {
      out.push({ kind: "single", part })
      i++
      continue
    }
    const tool = part.tool
    let j = i + 1
    while (j < parts.length) {
      const next = parts[j]
      if (!isCoalesceable(next)) break
      if (next.tool !== tool) break
      j++
    }
    const run = parts.slice(i, j) as ToolPart[]
    if (run.length >= COALESCE_MIN) {
      out.push({ kind: "coalesced", tool, parts: run, key: run[0].callID })
    } else {
      for (const p of run) out.push({ kind: "single", part: p })
    }
    i = j
  }
  return out
}
