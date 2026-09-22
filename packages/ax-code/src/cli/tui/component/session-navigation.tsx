import { useLanguage } from "@tui/context/language"
import type { BoxRenderable, ScrollBoxRenderable } from "ax-tui"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Setter } from "solid-js"
import { useKV } from "@tui/context/kv"
import { NAVIGATION_WIDTH_DEFAULT, chromeWidth } from "../chrome-width"
import { navigationRailInnerWidth } from "../navigation/navigation-layout"
import {
  activeNavigationSessions,
  navigationExpandedAncestors,
  navigationFilter,
  projectLabel,
  visibleAfterNavigationClear,
} from "../navigation/navigation-model"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { scheduleTuiTimeout } from "../util/timer"
import { ChromeAction, ChromeWidthAction } from "./chrome-action"
import { useCommandDialog } from "./dialog-command"
import { ScheduleStatus } from "./schedule-status"
import { ScheduledSessionNavigation } from "./scheduled-session-navigation"
import { SplitBorder } from "./border"
import { sessionNavigationEntries } from "./session-list-data"
import { createSessionActivityIndex, knownAttentionRequests } from "../util/session-activity"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"
import { isGoalPlannerSession } from "../routes/session/subagent-status-view"
import { Spinner } from "./spinner"

// Braille dot-cycle frames for the goal-planning pixel: braille is the only
// CJK-safe dot-matrix family (same constraint as the footer's animated pixel).
const GOAL_PLANNER_PIXEL_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function SessionNavigation(props: {
  width: number
  expanded: ReadonlySet<string>
  setExpanded: Setter<ReadonlySet<string>>
}) {
  const uiText = useLanguage().t

  const sync = useSync()
  const kv = useKV()
  const sdk = useSDK()
  const route = useRoute()
  const local = useLocal()
  const command = useCommandDialog()
  const { theme } = useTheme()
  const expanded = () => props.expanded
  const setExpanded = (value: Parameters<Setter<ReadonlySet<string>>>[0]) => props.setExpanded(value)
  const directory = () => sdk.directory ?? sync.data.path.directory
  const current = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const sessions = createMemo(() => sync.data.session.filter((session) => session.directory === directory()))
  const filter = () => navigationFilter(kv.get("navigation_filter"))
  const observed = () => sdk.sseConnected && sync.data.session_loaded
  // Deduplicated, sorted attention requests depend only on permissions and
  // questions; computed once here instead of inside each of the three
  // status-reactive memos below that build an activity index.
  const requests = createMemo(() => knownAttentionRequests(sync.data.permission, sync.data.question))
  const scopedSessions = createMemo(() =>
    filter() === "recent"
      ? sessions()
      : activeNavigationSessions({
          sessions: sessions(),
          statuses: sync.data.session_status,
          permissions: sync.data.permission,
          questions: sync.data.question,
          requests: requests(),
          currentID: current(),
          observed: observed(),
        }),
  )
  const visibleSessions = createMemo(() =>
    visibleAfterNavigationClear({
      sessions: scopedSessions(),
      clearedAt: kv.get("navigation_cleared_at"),
      currentID: current(),
      pinned: local.session.pinned(),
      statuses: sync.data.session_status,
      permissions: sync.data.permission,
      questions: sync.data.question,
      requests: requests(),
      observed: observed(),
    }),
  )
  const effectiveExpanded = createMemo(() => navigationExpandedAncestors(visibleSessions(), current(), expanded()))
  const rows = createMemo(() =>
    sessionNavigationEntries(visibleSessions(), local.session.pinned(), effectiveExpanded()),
  )
  const clearedHint = createMemo(() => scopedSessions().length > visibleSessions().length)
  const activity = createMemo(() =>
    createSessionActivityIndex({
      t: uiText,
      sessions: sessions(),
      statuses: sync.data.session_status,
      permissions: sync.data.permission,
      questions: sync.data.question,
      requests: requests(),
    }),
  )
  const pendingCount = createMemo(() => requests().length)
  const slots = createMemo(() => new Map(local.session.slots().map((id, index) => [id, index + 1])))
  const innerWidth = () => navigationRailInnerWidth(props.width)
  const preferredWidth = () => chromeWidth(kv.get("navigation_width"), NAVIGATION_WIDTH_DEFAULT)
  let scroll: ScrollBoxRenderable | undefined
  const rowNodes = new Map<string, BoxRenderable>()
  const rowIdentity = createMemo(() =>
    rows()
      .map((row) => row.session.id)
      .join(":"),
  )
  let stopReveal = () => {}
  function revealCurrent() {
    stopReveal()
    stopReveal = scheduleTuiTimeout(
      () => {
        const id = current()
        const node = id ? rowNodes.get(id) : undefined
        if (!node || !scroll || node.isDestroyed || scroll.isDestroyed) return
        const top = node.y - scroll.viewport.y
        const bottom = top + node.height
        if (top < 0) scroll.scrollBy(top)
        else if (bottom > scroll.viewport.height) scroll.scrollBy(bottom - scroll.viewport.height)
      },
      { name: "navigation-reveal-current", delayMs: 50, unref: true },
    )
  }
  onCleanup(() => stopReveal())
  createEffect(() => {
    current()
    rowIdentity()
    props.width
    revealCurrent()
  })

  return (
    <box
      width={props.width}
      flexShrink={0}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={0}
      overflow="hidden"
      backgroundColor={theme.backgroundPanel}
      border={["right"]}
      borderColor={theme.border}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box flexShrink={0} marginBottom={1} onMouseUp={() => command.trigger("session.navigation.info")}>
        <text fg={theme.text} selectable={false}>
          <b>{truncateToCellWidth(projectLabel(directory()), innerWidth())}</b>
        </text>
      </box>
      <box flexShrink={0} backgroundColor={theme.backgroundElement} onMouseUp={() => command.trigger("session.new")}>
        <text fg={theme.primary} selectable={false}>
          {truncateToCellWidth(uiText("ui.newSession"), innerWidth())}
        </text>
      </box>
      <box flexShrink={0} marginBottom={1} onMouseUp={() => command.trigger("session.navigation.find")}>
        <text fg={theme.textMuted} selectable={false}>
          {truncateToCellWidth(uiText("navigation.find"), innerWidth())}
        </text>
      </box>
      <Show when={pendingCount() > 0}>
        <box flexShrink={0} marginBottom={1} onMouseUp={() => command.trigger("session.attention")}>
          <box flexDirection="row" gap={1}>
            <text fg={observed() ? theme.warning : theme.textMuted} selectable={false}>
              {truncateToCellWidth(
                uiText("navigation.attention"),
                Math.max(0, innerWidth() - String(pendingCount()).length - 1),
              )}
            </text>
            <text flexShrink={0} fg={observed() ? theme.warning : theme.textMuted} selectable={false}>
              {pendingCount()}
            </text>
          </box>
          <text fg={theme.textMuted} selectable={false}>
            {truncateToCellWidth(uiText("ui.acrossWorkspaces"), innerWidth())}
          </text>
        </box>
      </Show>
      <Show when={!sdk.sseConnected}>
        <text flexShrink={0} fg={theme.textMuted} selectable={false}>
          {truncateToCellWidth(uiText("ui.cachedDisconnected"), innerWidth())}
        </text>
      </Show>
      <box flexShrink={0} flexDirection="row" gap={1} marginBottom={1}>
        <For each={["recent", "active"] as const}>
          {(value) => (
            <box
              flexShrink={0}
              paddingRight={1}
              backgroundColor={filter() === value ? theme.backgroundElement : undefined}
              onMouseUp={() => kv.set("navigation_filter", value)}
            >
              <text fg={filter() === value ? theme.primary : theme.textMuted} selectable={false}>
                <span style={{ bold: filter() === value }}>
                  {value === "recent" ? uiText("common.recent") : uiText("ui.active")}
                </span>
              </text>
            </box>
          )}
        </For>
      </box>
      <Show when={filter() === "active"}>
        <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
          {observed() ? uiText("ui.includesCurrentSession") : uiText("ui.cachedSessionsReconnectToFilter")}
        </text>
      </Show>
      <scrollbox
        onSizeChange={revealCurrent}
        ref={(node) => {
          scroll = node
        }}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.backgroundPanel, foregroundColor: theme.borderActive },
        }}
      >
        <ScheduledSessionNavigation width={innerWidth()} sessions={sessions()} />
        <Show when={rows().length === 0}>
          <text flexShrink={0} fg={theme.textMuted} selectable={false} wrapMode="word">
            {!sync.data.session_loaded
              ? uiText("ui.loadingSessions")
              : filter() === "active" && !clearedHint()
                ? uiText("ui.noActiveSessions")
                : clearedHint()
                  ? uiText("ui.clearedSessionsToResume")
                  : uiText("ui.noSessionsHere")}
          </text>
        </Show>
        <For each={rows()}>
          {(row) => {
            const state = createMemo(() => (observed() ? activity().get(row.session.id) : undefined))
            // The goal plan writer runs in a child session that otherwise looks
            // like any other "Working" row, so users can't tell planning is in
            // progress. Animate a pixel in front of its title while it is busy;
            // the pixel disappears on its own once the writer settles to idle.
            const planning = createMemo(() => {
              if (!observed() || !isGoalPlannerSession(row.session)) return false
              const type = sync.data.session_status?.[row.session.id]?.type
              return type !== undefined && type !== "idle"
            })
            const [hover, setHover] = createSignal(false)
            const indent = () => Math.min(row.depth, 3)
            const slot = () => slots().get(row.session.id)
            const selected = () => current() === row.session.id
            const label = () => state()?.label ?? ""
            const symbol = () => state()?.symbol
            // Reserve the scrollbar, selection marker, disclosure, status
            // symbol, planning pixel, and pinned slot.
            const titleWidth = () =>
              Math.max(0, innerWidth() - 4 - indent() - (symbol() ? 1 : 0) - (slot() ? 2 : 0) - (planning() ? 2 : 0))
            const openSession = () => route.navigate({ type: "session", sessionID: row.session.id })
            onCleanup(() => rowNodes.delete(row.session.id))
            return (
              <box
                ref={(node) => rowNodes.set(row.session.id, node)}
                flexShrink={0}
                flexDirection="row"
                marginLeft={indent()}
                onMouseOver={() => setHover(true)}
                onMouseOut={() => setHover(false)}
                backgroundColor={selected() ? theme.backgroundElement : hover() ? theme.background : undefined}
              >
                <box
                  width={1}
                  flexShrink={0}
                  backgroundColor={selected() ? theme.primary : undefined}
                  onMouseUp={openSession}
                />
                <box flexGrow={1} minWidth={0}>
                  <box flexDirection="row">
                    <box
                      width={2}
                      flexShrink={0}
                      onMouseUp={(event) => {
                        event.stopPropagation()
                        if (!row.hasChildren) return
                        setExpanded((previous) => {
                          const next = new Set(previous)
                          if (next.has(row.session.id)) next.delete(row.session.id)
                          else next.add(row.session.id)
                          return next
                        })
                      }}
                    >
                      <text fg={theme.textMuted} selectable={false}>
                        {row.hasChildren ? (effectiveExpanded().has(row.session.id) ? "−" : "+") : " "}
                      </text>
                    </box>
                    <Show when={symbol()}>
                      {/* One cell, matching the titleWidth reservation above:
                          a scan column of state glyphs that stays aligned
                          across rows at every rail width. Attention keeps the
                          warning color; retry and working keep primary, the
                          same split as the label row below. */}
                      <text flexShrink={0} fg={state()?.attention ? theme.warning : theme.primary} selectable={false}>
                        {symbol()}
                      </text>
                    </Show>
                    <Show when={planning()}>
                      {/* One cell for the pixel plus one of padding in both the
                          animated and the static fallback mode, matching the two
                          cells titleWidth reserves above. The fallback stays
                          ASCII: U+2026 is ambiguous-width and can render as two
                          cells in CJK terminals. */}
                      <box flexShrink={0} paddingRight={1} onMouseUp={openSession}>
                        <Spinner frames={GOAL_PLANNER_PIXEL_FRAMES} color={theme.primary} fallbackPrefix="*" />
                      </box>
                    </Show>
                    <box flexGrow={1} minWidth={0} onMouseUp={openSession}>
                      <text fg={selected() ? theme.primary : theme.text} selectable={false}>
                        <span style={{ bold: selected() }}>{truncateToCellWidth(row.session.title, titleWidth())}</span>
                      </text>
                    </box>
                    <Show when={slot()}>
                      <text flexShrink={0} fg={theme.textMuted} selectable={false}>
                        {slot()}{" "}
                      </text>
                    </Show>
                  </box>
                  <Show when={label()}>
                    <box flexDirection="row" gap={1} paddingLeft={2} onMouseUp={openSession}>
                      {/* Same state symbol as the title row, so both rows of an
                          entry speak one shape language; defined whenever the
                          label is. */}
                      <text flexShrink={0} fg={state()?.attention ? theme.warning : theme.primary} selectable={false}>
                        {symbol()}
                      </text>
                      <text fg={state()?.attention ? theme.warning : theme.textMuted} selectable={false}>
                        {truncateToCellWidth(label(), Math.max(0, innerWidth() - 6 - indent()))}
                      </text>
                    </box>
                  </Show>
                </box>
              </box>
            )
          }}
        </For>
      </scrollbox>
      <Show when={clearedHint()}>
        <box flexShrink={0} onMouseUp={() => kv.set("navigation_cleared_at", 0)}>
          <text fg={theme.primary} selectable={false}>
            {truncateToCellWidth(uiText("navigation.showHidden"), innerWidth())}
          </text>
        </box>
      </Show>
      <box flexShrink={0} marginTop={1}>
        <ScheduleStatus width={innerWidth()} compact showWhenEmpty />
        <box flexShrink={0} flexDirection="row" gap={2} flexWrap="wrap">
          <ChromeAction onMouseUp={() => command.trigger("session.navigation")}>/navigation</ChromeAction>
          <ChromeWidthAction width={preferredWidth()} onMouseUp={() => command.trigger("session.navigation.width")} />
        </box>
        <box onMouseUp={() => command.trigger("session.navigation.options")}>
          <text fg={theme.textMuted} selectable={false}>
            {truncateToCellWidth(uiText("navigation.options"), Math.max(0, innerWidth() - 2))} ›
          </text>
        </box>
      </box>
    </box>
  )
}
