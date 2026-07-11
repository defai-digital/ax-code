import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import type { Snapshot } from "@/snapshot"
import path from "path"

// An O(m*n) LCS over full-file line counts would allocate a giant matrix and
// block the UI thread — a ~20k-line file (e.g. a lockfile) OOM-crashes the TUI
// and even a few thousand lines freezes input. Cap the work the LCS can do.
const LCS_CELL_BUDGET = 1_000_000

export function computeDiffLines(
  before: string,
  after: string,
): Array<{ type: "add" | "remove" | "context"; text: string }> {
  const beforeLines = before ? before.split("\n") : []
  const afterLines = after ? after.split("\n") : []

  const m = beforeLines.length
  const n = afterLines.length

  const result: Array<{ type: "add" | "remove" | "context"; text: string }> = []

  // Trim the common leading/trailing identical lines and only diff the changed
  // middle. Localized edits in a huge file collapse to a tiny middle window, so
  // the LCS stays cheap even when the file itself is enormous.
  let start = 0
  while (start < m && start < n && beforeLines[start] === afterLines[start]) start++
  let endB = m
  let endA = n
  while (endB > start && endA > start && beforeLines[endB - 1] === afterLines[endA - 1]) {
    endB--
    endA--
  }

  for (let k = 0; k < start; k++) result.push({ type: "context", text: "  " + beforeLines[k] })

  const midM = endB - start
  const midN = endA - start

  if (midM > 0 || midN > 0) {
    if (midM * midN > LCS_CELL_BUDGET) {
      // The changed window is still too large to diff on the UI thread. Fall
      // back to a degenerate diff (all removals, then all additions) — correct,
      // O(m+n), and never allocates the LCS matrix.
      for (let k = start; k < endB; k++) result.push({ type: "remove", text: "- " + beforeLines[k] })
      for (let k = start; k < endA; k++) result.push({ type: "add", text: "+ " + afterLines[k] })
    } else {
      // LCS over the changed middle only. Use a flat Int32Array matrix instead
      // of number[][] to keep the allocation compact (<=~4MB at the budget cap).
      const width = midN + 1
      const dp = new Int32Array((midM + 1) * width)
      for (let i = 1; i <= midM; i++) {
        const bLine = beforeLines[start + i - 1]
        const row = i * width
        const prevRow = row - width
        for (let j = 1; j <= midN; j++) {
          dp[row + j] =
            bLine === afterLines[start + j - 1] ? dp[prevRow + j - 1] + 1 : Math.max(dp[prevRow + j], dp[row + j - 1])
        }
      }

      const ops: Array<"=" | "+" | "-"> = []
      let i = midM
      let j = midN
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && beforeLines[start + i - 1] === afterLines[start + j - 1]) {
          ops.push("=")
          i--
          j--
        } else if (j > 0 && (i === 0 || dp[i * width + (j - 1)] >= dp[(i - 1) * width + j])) {
          ops.push("+")
          j--
        } else {
          ops.push("-")
          i--
        }
      }
      ops.reverse()

      let bi = start
      let ai = start
      for (const op of ops) {
        if (op === "=") {
          result.push({ type: "context", text: "  " + beforeLines[bi] })
          bi++
          ai++
        } else if (op === "-") {
          result.push({ type: "remove", text: "- " + beforeLines[bi] })
          bi++
        } else {
          result.push({ type: "add", text: "+ " + afterLines[ai] })
          ai++
        }
      }
    }
  }

  for (let k = endB; k < m; k++) result.push({ type: "context", text: "  " + beforeLines[k] })

  return result
}

function DialogDiffDetail(props: { diff: Snapshot.FileDiff }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  onMount(() => dialog.setSize("large"))

  const lines = createMemo(() => computeDiffLines(props.diff.before ?? "", props.diff.after ?? ""))

  const options = createMemo((): DialogSelectOption<string>[] => {
    if (lines().length === 0) {
      return [{ title: "No diff content available", value: "empty", disabled: true }]
    }
    return lines().map((line, i) => ({
      title: "",
      description: line.text || " ",
      value: String(i),
      descriptionFg: line.type === "add" ? theme.success : line.type === "remove" ? theme.error : undefined,
      disabled: true,
    }))
  })

  return (
    <DialogSelect
      title={`Diff: ${path.basename(props.diff.file)} (+${props.diff.additions} −${props.diff.deletions})`}
      options={options()}
      skipFilter={true}
    />
  )
}

export function DialogDiffViewer(props: { sessionID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()

  onMount(() => dialog.setSize("large"))

  const diffs = createMemo<Snapshot.FileDiff[]>(() => {
    const sessionDiffs = sync.data.session_diff[props.sessionID] ?? []
    const sessionSummary = sync.data.session.find((s) => s.id === props.sessionID)?.summary?.diffs ?? []
    return sessionDiffs.length > 0 ? sessionDiffs : sessionSummary
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const all = diffs()
    if (all.length === 0) {
      return [
        {
          title: "No file changes",
          value: "empty",
          description: "No file diffs are available for this session.",
          disabled: true,
        },
      ]
    }

    return all.map((diff) => {
      const statusLabel = diff.status === "added" ? "added" : diff.status === "deleted" ? "deleted" : "modified"
      const statusFg = diff.status === "added" ? theme.success : diff.status === "deleted" ? theme.error : theme.warning
      const icon = diff.status === "added" ? "+" : diff.status === "deleted" ? "-" : "~"
      return {
        title: `${icon} ${diff.file}`,
        value: diff.file,
        description: `${statusLabel} · +${diff.additions} −${diff.deletions}`,
        descriptionFg: statusFg,
        category: statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1),
        onSelect: (ctx) => {
          ctx.replace(() => <DialogDiffDetail diff={diff} />)
        },
      }
    })
  })

  return (
    <DialogSelect
      title={`Changes (${diffs().length} file${diffs().length !== 1 ? "s" : ""})`}
      options={options()}
      skipFilter={true}
    />
  )
}
