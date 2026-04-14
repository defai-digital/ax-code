import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/provider-state"
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
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissionLabel()}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissionLabel()}
              </text>
            </Show>
            <Show when={trustChip()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={trustChip()?.type === "plans"}>
                    <span style={{ fg: theme.warning }}>◆</span> {trustChip()?.label}
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>◆</span> {trustChip()?.label}
                  </Match>
                </Switch>
              </text>
            </Show>
            <Show when={mcp().connected}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcp().hasError}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp().connected} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
        <text fg={sandbox().risk === "danger" ? theme.error : theme.success}>{sandbox().label}</text>
        <text fg={theme.textMuted}>v{Installation.VERSION}</text>
      </box>
    </box>
  )
}
