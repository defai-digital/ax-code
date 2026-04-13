import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/provider-state"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"

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
  const drePending = createMemo(() => sync.data.debugEngine.pendingPlans)
  const dreGraphIndexed = createMemo(
    () => Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE && sync.data.debugEngine.graph.nodeCount > 0,
  )
  const dreChipVisible = createMemo(() => drePending() > 0 || dreGraphIndexed())
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
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
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={dreChipVisible()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={drePending() > 0}>
                    {/* Pending-plan state: warning color + count. This
                        is the original v2.3.1 behavior, preserved so
                        users with active refactor work see the same
                        chip they already know. */}
                    <span style={{ fg: theme.warning }}>◆</span> {drePending()} Plan{drePending() !== 1 ? "s" : ""}
                  </Match>
                  <Match when={true}>
                    {/* Ready state: success color + static label. New
                        in v2.3.8. Fires only when the graph is indexed
                        (nodeCount > 0) so the chip never appears
                        while `ax-code index` is still required — the
                        sidebar owns that onboarding hint. */}
                    <span style={{ fg: theme.success }}>◆</span> DRE ready
                  </Match>
                </Switch>
              </text>
            </Show>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
        <text fg={isolationMode() === "full-access" ? theme.error : theme.success}>
          {isolationMode() === "full-access" ? "sandbox off" : "sandbox on"}
        </text>
        <text fg={theme.textMuted}>v{Installation.VERSION}</text>
      </box>
    </box>
  )
}
