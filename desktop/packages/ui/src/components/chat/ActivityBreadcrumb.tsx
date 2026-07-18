import React from "react"
import type { Part } from "@ax-code/sdk/v2/client"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { useStreamingStore } from "@/sync/streaming"
import { useSessionStatus, useSessionMessageRecords } from "@/sync/sync-context"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Map tool names to icon names
const TOOL_ICONS: Record<string, IconName> = {
  read_file: "file-text",
  write_file: "file-edit",
  write_to_file: "file-edit",
  edit_file: "file-edit",
  str_replace_editor: "file-edit",
  patch_file: "file-edit",
  bash: "terminal",
  execute_command: "terminal",
  run_terminal_cmd: "terminal",
  computer: "terminal",
  search_files: "file-search",
  grep_search: "search",
  glob_search: "search",
  list_dir: "file-list-2",
  web_search: "search",
  web_fetch: "search",
  git_diff: "git-branch",
  git_log: "git-commit",
  git: "git-branch",
  todo_write: "list-check-2",
  todo_read: "list-check-2",
  dispatch_agent: "code-ai",
}

function toolIcon(toolName: string): IconName {
  const lower = toolName.toLowerCase().replace(/[:\d]+$/, "")
  if (TOOL_ICONS[lower]) return TOOL_ICONS[lower]
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key) || key.includes(lower.split("_")[0] ?? "")) return icon
  }
  return "code-ai"
}

function getRunningToolPart(parts: Part[]): { tool: string; title?: string } | null {
  // Scan from the end — the most recent running/pending tool is what we show
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part.type !== "tool") continue
    const state = (part as { state?: { status?: string; title?: string } }).state
    if (!state) continue
    if (state.status === "running" || state.status === "pending") {
      return {
        tool: typeof (part as { tool?: unknown }).tool === "string" ? (part as { tool: string }).tool : "",
        title: typeof state.title === "string" ? state.title : undefined,
      }
    }
  }
  return null
}

type ActivityBreadcrumbProps = {
  sessionId: string
  directory?: string
  className?: string
}

/**
 * Renders a single compact line showing the agent's current tool call.
 * Visible only while the session is busy; collapses to nothing when idle.
 * Isolated DOM node — must not cause re-renders in the message list.
 */
export const ActivityBreadcrumb: React.FC<ActivityBreadcrumbProps> = ({ sessionId, directory, className }) => {
  const { t } = useI18n()
  const status = useSessionStatus(sessionId, directory)
  const streamingMessageId = useStreamingStore(
    React.useCallback((s) => s.streamingMessageIds.get(sessionId) ?? null, [sessionId]),
  )
  const records = useSessionMessageRecords(sessionId, directory, { suspendPartUpdates: false })

  const activity = React.useMemo(() => {
    if (!streamingMessageId || !status || status.type !== "busy") return null
    const record = records.find((r) => r.info.id === streamingMessageId)
    if (!record) return null
    return getRunningToolPart(record.parts)
  }, [records, status, streamingMessageId])

  if (!activity) return null

  const icon = toolIcon(activity.tool)
  const label = activity.title ?? activity.tool.replace(/_/g, " ")

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-4 py-1 typography-micro text-muted-foreground",
        "border-t border-border/40 bg-background/60 backdrop-blur-sm",
        className,
      )}
      aria-live="polite"
      aria-label={t("chat.activity.aria", { label })}
    >
      <Icon name={icon} className="h-3 w-3 shrink-0 opacity-60" />
      <span className="truncate opacity-80">{label}</span>
    </div>
  )
}
