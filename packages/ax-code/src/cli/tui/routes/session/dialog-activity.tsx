import { useLanguage } from "@tui/context/language"
import { createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { EventQuery } from "@/replay/query"
import { useDialog } from "../../ui/dialog"
import { statusLabel } from "./activity"
import {
  buildEntries,
  buildRows,
  defaultExpanded,
  filterLabel,
  groupBadge,
  groupKeys,
  nextFilter,
  summarize,
  summaryText,
  type ActivityFilter,
  type ActivityMode,
} from "./activity-browser"
import { DialogActivityDetail } from "./dialog-activity-detail"

/** View state that survives opening an entry and coming back. */
export type ActivityViewState = {
  mode: ActivityMode
  filter: ActivityFilter
  expanded: string[] | undefined
  selected?: string
}

export function DialogActivity(props: {
  sessionID: string
  /** Scroll the conversation to a message; offered from an entry's detail view. */
  onJump?: (messageID: string) => void
  state?: ActivityViewState
}) {
  const uiText = useLanguage().t
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const [mode, setMode] = createSignal<ActivityMode>(props.state?.mode ?? "table")
  const [filter, setFilter] = createSignal<ActivityFilter>(props.state?.filter ?? "all")
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<string | undefined>(props.state?.selected)

  const entries = createMemo(() => {
    const messages = sync.data.message[props.sessionID] ?? []
    const parts = messages.flatMap((msg) => sync.data.part[msg.id] ?? [])
    const sid = props.sessionID as Parameters<typeof EventQuery.bySessionWithTimestamp>[0]
    return buildEntries(parts, EventQuery.bySessionWithTimestamp(sid), sync.data.agent)
  })

  // Groups holding something a reviewer should open first start expanded.
  const [expanded, setExpanded] = createSignal(new Set(props.state?.expanded ?? defaultExpanded(entries())))
  const toggleGroup = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const rows = createMemo(() =>
    buildRows({ entries: entries(), mode: mode(), filter: filter(), query: query(), expanded: expanded() }),
  )
  const allOpen = createMemo(() => groupKeys(entries()).every((key) => expanded().has(key)))

  const snapshot = (): ActivityViewState => ({
    mode: mode(),
    filter: filter(),
    expanded: [...expanded()],
    selected: selected(),
  })

  const open = (id: string) => {
    const list = rows().flatMap((row) => (row.type === "entry" ? [row.entry] : []))
    const index = list.findIndex((entry) => entry.id === id)
    if (index < 0) return
    const state = { ...snapshot(), selected: id }
    dialog.replace(() => (
      <DialogActivityDetail
        entries={entries()}
        visible={list}
        index={index}
        onJump={props.onJump}
        onBack={() =>
          dialog.replace(() => <DialogActivity sessionID={props.sessionID} onJump={props.onJump} state={state} />)
        }
      />
    ))
  }

  const attentionColor = (attention: string | undefined) =>
    attention === "error" || attention === "denied" ? theme.error : attention === "approval" ? theme.warning : undefined

  const options = createMemo((): DialogSelectOption<string>[] => {
    const summary = summarize(entries())
    const controls: DialogSelectOption<string>[] = [
      {
        title: summaryText(summary),
        value: "summary",
        description: summary.total === 0 ? "No activity has been recorded for this session yet." : undefined,
        disabled: true,
      },
      {
        title: `View: ${mode() === "table" ? "Table" : "Tree"}`,
        value: "control:mode",
        description: `Enter to switch to the ${mode() === "table" ? "tree (grouped, collapsible)" : "table (flat, newest first)"}`,
        onSelect: () => setMode(mode() === "table" ? "tree" : "table"),
      },
      {
        title: `Filter: ${filterLabel(filter())}`,
        value: "control:filter",
        description: `Enter for ${filterLabel(nextFilter(filter()))}`,
        onSelect: () => setFilter(nextFilter(filter())),
      },
      ...(mode() === "tree"
        ? [
            {
              title: allOpen() ? "Collapse all groups" : "Expand all groups",
              value: "control:groups",
              onSelect: () => setExpanded(allOpen() ? new Set<string>() : new Set(groupKeys(entries()))),
            },
          ]
        : []),
    ]
    const body = rows().map((row): DialogSelectOption<string> => {
      if (row.type === "group") {
        return {
          title: `${row.open ? "▾" : "▸"} ${row.label}`,
          value: `group:${row.key}`,
          description: groupBadge(row),
          descriptionFg: row.errors > 0 ? theme.error : row.approvals > 0 ? theme.warning : undefined,
          onSelect: () => toggleGroup(row.key),
        }
      }
      const entry = row.entry
      return {
        title: `${row.indent ? "  " : ""}${entry.icon} ${entry.label}`,
        value: entry.id,
        description: `[${statusLabel(entry.status)}]${entry.description ? ` ${entry.description}` : ""}`,
        descriptionFg: attentionColor(entry.attention),
        footer: entry.time != null ? Locale.time(entry.time) : undefined,
        onSelect: () => open(entry.id),
      }
    })
    return [...controls, ...body]
  })

  return (
    <DialogSelect
      title={uiText("ui.activityHistory")}
      placeholder="Search activity: tool, status, path, reason"
      options={options()}
      skipFilter
      onFilter={setQuery}
      onMove={(option) => setSelected(option.value)}
      current={props.state?.selected}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "view",
          onTrigger: () => setMode(mode() === "table" ? "tree" : "table"),
        },
        {
          keybind: Keybind.parse("ctrl+o")[0],
          title: "filter",
          onTrigger: () => setFilter(nextFilter(filter())),
        },
      ]}
    />
  )
}
