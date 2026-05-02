import { type Accessor, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { Session } from "@ax-code/sdk/v2"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "../../context/keybind"
import { Flag } from "@/flag/flag"
import { useTerminalDimensions } from "@opentui/solid"
import { collapseSessionBreadcrumbs, sessionBreadcrumbs } from "./header-view-model"
import { computeSidebarWidth } from "./layout"

const SUBAGENT_PARENT_DOUBLE_CLICK_MS = 400

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

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID))

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
  let lastSubagentHeaderClickAt = 0
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
  function handleSubagentHeaderMouseUp() {
    const now = Date.now()
    if (now - lastSubagentHeaderClickAt <= SUBAGENT_PARENT_DOUBLE_CLICK_MS) {
      lastSubagentHeaderClickAt = 0
      command.trigger("session.parent")
      return
    }
    lastSubagentHeaderClickAt = now
  }

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
                <box flexDirection="column" onMouseUp={handleSubagentHeaderMouseUp}>
                  <text fg={theme.text}>
                    <b>Subagent session</b>
                  </text>
                  <Show when={session()?.id}>{(id) => <text fg={theme.textMuted}>{id()}</text>}</Show>
                  <Show when={Flag.AX_CODE_EXPERIMENTAL_WORKSPACES}>
                    <WorkspaceInfo workspace={workspace} />
                  </Show>
                </box>
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
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
