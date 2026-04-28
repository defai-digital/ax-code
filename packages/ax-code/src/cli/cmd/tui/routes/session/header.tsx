import { type Accessor, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@ax-code/sdk/v2"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "../../context/keybind"
import { Flag } from "@/flag/flag"
import { useTerminalDimensions } from "@opentui/solid"
import { Usage } from "./usage"
import { collapseSessionBreadcrumbs, sessionBreadcrumbs } from "./header-view-model"
import { computeSidebarWidth } from "./layout"

const Title = (props: { session: Accessor<Session | undefined> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.session()} fallback={<text fg={theme.textMuted}>Loading session...</text>}>
      {(s) => (
        <box flexDirection="column">
          <text fg={theme.text}>
            <span style={{ bold: true }}>{s().title}</span>
          </text>
          <text fg={theme.textMuted}>{s().id}</text>
        </box>
      )}
    </Show>
  )
}

const WorkspaceInfo = (props: { workspace: Accessor<string | undefined> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.workspace()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.workspace()}
      </text>
    </Show>
  )
}

// Token / context utilization read-out shown on the right side of the
// header (#180 — was inadvertently removed during a header polish pass
// in ca1fceb). Strictly token usage; ax-code does not track or display
// monetary cost (see script/check-no-cost.ts CI guard).
const ContextInfo = (props: { context: Accessor<string | undefined> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.context()}
      </text>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  // Build the right-side read-out: total tokens + context-window bar +
  // tokens/sec for the most recent assistant turn that has usage data.
  // Returns undefined when no assistant message has been received yet,
  // which keeps the header clean on a brand-new session.
  const context = createMemo(() => {
    // `Usage.last` selects on the presence of a `tokens` field. The SDK
    // schema only puts `tokens` on assistant messages, but a corrupt
    // session payload (replay artifact, custom provider stuffing tokens
    // into the wrong place, etc.) would otherwise pass the `as
    // AssistantMessage` cast and feed garbage into `last.time.completed`
    // / `last.tokens.output`. Defensive role check keeps the read-out
    // honest under malformed data.
    const candidate = Usage.last(messages()) as AssistantMessage | undefined
    if (!candidate || candidate.role !== "assistant") return
    const last = candidate
    const total = Usage.total(last)
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit?.context) {
      const pct = Math.min(100, Math.round((total / model.limit.context) * 100))
      const filled = Math.round(pct / 10)
      const bar = "█".repeat(filled) + "░".repeat(10 - filled)
      result += "  " + bar + " " + pct + "%"
    }
    if (last.time.completed && last.time.created && (last.tokens?.output ?? 0) > 0) {
      const durationSecs = (last.time.completed - last.time.created) / 1000
      if (durationSecs > 0) {
        const tps = Math.round((last.tokens?.output ?? 0) / durationSecs)
        result += "  " + tps + " tok/s"
      }
    }
    return result
  })

  const workspace = createMemo(() => {
    const id = session()?.directory
    if (!id || id === sync.data.path.directory) return "Workspace local"
    const info = sync.workspace.get(id)
    if (!info) return `Workspace ${id}`
    return `Workspace ${info}`
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => {
    const sw = dimensions().width > 120 ? computeSidebarWidth(dimensions().width) : 0
    return dimensions().width - sw < 100
  })
  const breadcrumbs = createMemo(() =>
    collapseSessionBreadcrumbs(sessionBreadcrumbs(sync.data.session, route.sessionID), {
      narrow: narrow(),
    }),
  )

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <Switch>
          <Match when={session()?.parentID}>
            <box flexDirection="column" gap={1}>
              <Show when={breadcrumbs().length > 0}>
                <text fg={theme.textMuted}>
                  <For each={breadcrumbs()}>
                    {(item, index) => (
                      <>
                        <Show when={index() > 0}>
                          <span style={{ fg: theme.textMuted }}> &gt; </span>
                        </Show>
                        <span
                          style={{
                            fg: item.kind === "session" && item.current ? theme.text : theme.textMuted,
                            bold: item.kind === "session" && item.current,
                          }}
                        >
                          {item.label}
                        </span>
                      </>
                    )}
                  </For>
                </text>
              </Show>
              <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={narrow() ? 1 : 0}>
                <box flexDirection="column">
                  <text fg={theme.text}>
                    <b>Subagent session</b>
                  </text>
                  <Show when={session()?.id}>{(id) => <text fg={theme.textMuted}>{id()}</text>}</Show>
                  <Show when={Flag.AX_CODE_EXPERIMENTAL_WORKSPACES}>
                    <WorkspaceInfo workspace={workspace} />
                  </Show>
                </box>
                <ContextInfo context={context} />
              </box>
              <box flexDirection="row" gap={2}>
                <box flexDirection="row" gap={1}>
                  <box
                    onMouseOver={() => setHover("parent")}
                    onMouseOut={() => setHover(null)}
                    onMouseUp={() => command.trigger("session.parent")}
                    backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.primary}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={hover() === "parent" ? theme.text : theme.background}>Back to Parent</text>
                  </box>
                  <text fg={theme.textMuted}>{keybind.print("session_parent")}</text>
                </box>
                <box
                  onMouseOver={() => setHover("prev")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.child.previous")}
                  backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
                >
                  <text fg={theme.text}>
                    Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                  </text>
                </box>
                <box
                  onMouseOver={() => setHover("next")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.child.next")}
                  backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
                >
                  <text fg={theme.text}>
                    Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
                  </text>
                </box>
              </box>
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={narrow() ? 1 : 0}>
              <box flexDirection="column">
                <Title session={session} />
                <Show when={Flag.AX_CODE_EXPERIMENTAL_WORKSPACES}>
                  <WorkspaceInfo workspace={workspace} />
                </Show>
              </box>
              <ContextInfo context={context} />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
