import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/provider-state"
import { useSDK } from "../../context/sdk"
import { useKeybind } from "../../context/keybind"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { AgentControlReplayQuery } from "@/replay/agent-control-query"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import {
  footerPermissionLabel,
  footerTrustChip,
  footerAgentControlStatusView,
  footerGoalChip,
  footerProgressBar,
  isFooterSessionStatus,
  type FooterSessionStatus,
} from "./footer-view-model"

const RECONNECT_DEBOUNCE_MS = 3_000

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const isolationMode = createMemo(() => sync.data.isolation.mode)
  // DRE footer chip state (v2.3.8). The chip has three visible states:
  //   1. Pending plans exist    → "◆ N Plans"    (warning-colored)
  //   2. Graph indexed, no plans → "◆ DRE ready" (success-colored)
  //   3. Otherwise               → hidden
  // State 1 is the original v2.3.1 behavior. State 2 is new in v2.3.8
  // and answers "is DRE actually usable right now?" at a glance from
  // the footer, mirroring the sidebar DRE section's visibility rule
  // from v2.3.6. State 3 covers flag-off AND flag-on-but-graph-empty:
  // in the empty-graph case the sidebar already tells the user to run
  // `ax-code index`, and a second "DRE" chip in the footer without
  // that context would be actively misleading.
  const trustChip = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return footerTrustChip({
      experimentalDebugEngine: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      pendingPlans: sync.data.debugEngine.pendingPlans,
      graphNodeCount: sync.data.debugEngine.graph.nodeCount,
    })
  })
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const permissionLabel = createMemo(() => footerPermissionLabel(permissions().length))
  // Session step progress for the footer bar. Pure data-driven: re-renders
  // only when `step` or `maxSteps` advance via SessionStatus events. No
  // animation frames, no internal tick — see footerProgressBar() rationale.
  const sessionStatus = createMemo<FooterSessionStatus>(() => {
    if (route.data.type !== "session") return { type: "idle" }
    const candidate = sync.data.session_status?.[route.data.sessionID]
    return isFooterSessionStatus(candidate) ? candidate : { type: "idle" }
  })
  const directory = useDirectory()
  const connected = useConnected()
  const sdk = useSDK()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  // Width-adaptive chip visibility: drop low-priority decorations on narrow
  // terminals so critical signals (permissions, reconnecting, sandbox-off,
  // version) always survive.
  const showHints = createMemo(() => dimensions().width >= 100)
  const showLspChip = createMemo(() => dimensions().width >= 90 && lsp().length > 0)
  const showDreChip = createMemo(() => dimensions().width >= 80)
  const showGoalChip = createMemo(() => dimensions().width >= 100)
  const progressBar = createMemo(() =>
    footerProgressBar({ status: sessionStatus(), terminalWidth: dimensions().width }),
  )
  const showDreStatus = createMemo(() => trustChip() !== undefined && showDreChip())
  const agentControlStatus = createMemo(() => {
    if (route.data.type !== "session") return undefined
    void sync.data.message[route.data.sessionID]
    void sync.data.permission[route.data.sessionID]
    void sync.data.session_status?.[route.data.sessionID]
    const sessionID = route.data.sessionID as Parameters<typeof AgentControlReplayQuery.summaryBySession>[0]
    const readModel = AgentControlReplayQuery.readModelBySession(sessionID)
    return footerAgentControlStatusView(readModel.summary, readModel.tools)
  })
  const showAgentControlStatus = createMemo(() => dimensions().width >= 115 && !!agentControlStatus())
  const goalChip = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return footerGoalChip({ goal: sync.data.session_goal[route.data.sessionID] })
  })
  const agentControlStatusColor = createMemo(() => {
    switch (agentControlStatus()?.tone) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "working":
        return theme.accent
      case "muted":
      default:
        return theme.textMuted
    }
  })
  const showSecondaryStatus = createMemo(() => mcp() > 0 || showLspChip() || showHints())
  const showStatusSeparator = createMemo(
    () => (permissionLabel() || showDreStatus() || showAgentControlStatus() || goalChip()) && showSecondaryStatus(),
  )
  const goalChipColor = createMemo(() => {
    switch (goalChip()?.tone) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "working":
        return theme.accent
      case "muted":
      default:
        return theme.textMuted
    }
  })

  // Show "reconnecting" badge only after the first successful connection —
  // avoids a false-alarm flash during initial startup. A 3-second debounce
  // prevents flicker on fast reconnects (watchdog trip + immediate recovery).
  const [showReconnecting, setShowReconnecting] = createSignal(false)
  let everConnected = false
  let reconnectDebounce: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const isConnected = sdk.sseConnected
    if (isConnected) {
      everConnected = true
      if (reconnectDebounce) {
        clearTimeout(reconnectDebounce)
        reconnectDebounce = undefined
      }
      setShowReconnecting(false)
      return
    }
    if (!everConnected) return
    if (reconnectDebounce) return
    reconnectDebounce = setTimeout(() => {
      reconnectDebounce = undefined
      if (!sdk.sseConnected) setShowReconnecting(true)
    }, RECONNECT_DEBOUNCE_MS)
  })
  onCleanup(() => {
    if (reconnectDebounce) clearTimeout(reconnectDebounce)
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  createEffect(() => {
    if (connected()) {
      if (store.welcome) setStore("welcome", false)
      return
    }

    if (store.welcome) return

    const pending = setTimeout(() => {
      setStore("welcome", true)
    }, 10_000)

    onCleanup(() => {
      clearTimeout(pending)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={theme.textMuted}>{directory()}</text>
        <Show when={progressBar()}>
          {(bar) => (
            <text>
              <span style={{ fg: theme.borderSubtle }}>[</span>
              <span style={{ fg: bar().overSoftMax ? theme.warning : theme.accent }}>{bar().filled}</span>
              <span style={{ fg: theme.borderSubtle }}>{bar().empty}</span>
              <span style={{ fg: theme.borderSubtle }}>]</span>
              <span style={{ fg: bar().overSoftMax ? theme.warning : theme.textMuted }}> {bar().label}</span>
            </text>
          )}
        </Show>
      </box>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.accent }}>/connect</span>
              <span style={{ fg: theme.textMuted }}> · 75+ providers supported</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissionLabel()}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>▲</span> {permissionLabel()}
              </text>
            </Show>
            <Show when={showDreStatus()}>
              <Show when={trustChip()} keyed>
                {(chip) => (
                  <text fg={chip.type === "plans" ? theme.warning : theme.success}>
                    <span style={{ fg: chip.type === "plans" ? theme.warning : theme.success }}>◆</span> {chip.label}
                  </text>
                )}
              </Show>
            </Show>
            <Show when={showAgentControlStatus()}>
              <text fg={agentControlStatusColor()}>{agentControlStatus()?.label}</text>
            </Show>
            <Show when={showGoalChip() && goalChip()}>
              <text fg={goalChipColor()}>{goalChip()?.label}</text>
            </Show>
            <Show when={showStatusSeparator()}>
              <text fg={theme.borderSubtle}>·</text>
            </Show>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>● </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>● </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <Show when={showLspChip()}>
              <text fg={theme.text}>
                <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
              </text>
            </Show>
            <Show when={showHints()}>
              <text fg={theme.textMuted}>/help · /status</text>
            </Show>
          </Match>
        </Switch>
        <Show when={keybind.leader}>
          <text fg={theme.warning}>[leader]</text>
        </Show>
        <Show when={showReconnecting()}>
          <text fg={theme.warning}>reconnecting...</text>
        </Show>
        <Show when={isolationMode() === "full-access"}>
          <text fg={theme.error}>sandbox off</text>
        </Show>
        <text fg={theme.textMuted}>v{Installation.VERSION}</text>
      </box>
    </box>
  )
}
