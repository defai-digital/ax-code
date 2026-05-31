import { createMemo, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import type { Snapshot } from "@/snapshot"
import path from "path"

function computeDiffLines(before: string, after: string): Array<{ type: "add" | "remove" | "context"; text: string }> {
  const beforeLines = before ? before.split("\n") : []
  const afterLines = after ? after.split("\n") : []

  // Simple LCS diff
  const m = beforeLines.length
  const n = afterLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = beforeLines[i - 1] === afterLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])

  const ops: Array<"=" | "+" | "-"> = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      ops.push("="); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push("+"); j--
    } else {
      ops.push("-"); i--
    }
  }
  ops.reverse()

  const result: Array<{ type: "add" | "remove" | "context"; text: string }> = []
  let bi = 0
  let ai = 0
  for (const op of ops) {
    if (op === "=") { result.push({ type: "context", text: "  " + beforeLines[bi] }); bi++; ai++ }
    else if (op === "-") { result.push({ type: "remove", text: "- " + beforeLines[bi] }); bi++ }
    else { result.push({ type: "add", text: "+ " + afterLines[ai] }); ai++ }
  }
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

  return <DialogSelect title={`Changes (${diffs().length} file${diffs().length !== 1 ? "s" : ""})`} options={options()} skipFilter={true} />
}
