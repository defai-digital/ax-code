import { createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/provider-state"
import { useSDK } from "../../context/sdk"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { footerMcpView, footerPermissionLabel, footerSandboxView, footerTrustChip } from "./footer-view-model"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const isolationMode = createMemo(() => sync.data.isolation.mode)
  const mcp = createMemo(() => footerMcpView(Object.values(sync.data.mcp).map((item) => item.status)))
  const trustChip = createMemo(() =>
    footerTrustChip({
      experimentalDebugEngine: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      pendingPlans: sync.data.debugEngine.pendingPlans,
      graphNodeCount: sync.data.debugEngine.graph.nodeCount,
    }),
  )
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const permissionLabel = createMemo(() => footerPermissionLabel(permissions().length))
  const sandbox = createMemo(() => footerSandboxView(isolationMode()))
  const directory = useDirectory()
  const connected = useConnected()
  const sdk = useSDK()

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
    }, 3000)
  })
  onCleanup(() => {
    if (reconnectDebounce) clearTimeout(reconnectDebounce)
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    let pending: ReturnType<typeof setTimeout> | undefined

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        pending = setTimeout(() => tick(), 5000)
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        pending = setTimeout(() => tick(), 10_000)
        return
      }
    }
    pending = setTimeout(() => tick(), 10_000)

    onCleanup(() => {
      if (pending !== undefined) clearTimeout(pending)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <box flexDirection="row" gap={0}>
              <text fg={theme.text}>Get started </text>
              <text fg={theme.textMuted}>/connect</text>
            </box>
          </Match>
          <Match when={connected()}>
            <Show when={permissionLabel()}>
              <box flexDirection="row" gap={0}>
                <text fg={theme.warning}>△ </text>
                <text fg={theme.warning}>{permissionLabel()}</text>
              </box>
            </Show>
            <Show when={trustChip()}>
              <box flexDirection="row" gap={0}>
                <Switch>
                  <Match when={trustChip()?.type === "plans"}>
                    <>
                      <text fg={theme.warning}>◆ </text>
                      <text fg={theme.text}>{trustChip()?.label}</text>
                    </>
                  </Match>
                  <Match when={true}>
                    <>
                      <text fg={theme.success}>◆ </text>
                      <text fg={theme.text}>{trustChip()?.label}</text>
                    </>
                  </Match>
                </Switch>
              </box>
            </Show>
            <Show when={mcp().connected}>
              <box flexDirection="row" gap={0}>
                <Switch>
                  <Match when={mcp().hasError}>
                    <text fg={theme.error}>⊙ </text>
                  </Match>
                  <Match when={true}>
                    <text fg={theme.success}>⊙ </text>
                  </Match>
                </Switch>
                <text fg={theme.text}>{mcp().connected} MCP</text>
              </box>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
        <Show when={showReconnecting()}>
          <text fg={theme.warning}>reconnecting...</text>
        </Show>
        <text fg={sandbox().risk === "danger" ? theme.error : theme.success}>{sandbox().label}</text>
        <text fg={theme.textMuted}>v{Installation.VERSION}</text>
      </box>
    </box>
  )
}
