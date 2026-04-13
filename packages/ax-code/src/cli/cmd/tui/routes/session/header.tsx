import { type Accessor, createMemo, createSignal, Match, Show, Switch } from "solid-js"
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

const Title = (props: { session: Accessor<Session | undefined> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>#</span>{" "}
      <span style={{ bold: true }}>{props.session()?.title ?? "Loading session..."}</span>
    </text>
  )
}

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
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const context = createMemo(() => {
    const last = Usage.last(messages()) as AssistantMessage
    if (!last) return
    const total = Usage.total(last)
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit?.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    if (last.time.completed && last.time.created && last.tokens.output > 0) {
      const durationSecs = (last.time.completed - last.time.created) / 1000
      if (durationSecs > 0) {
        const tps = Math.round(last.tokens.output / durationSecs)
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
    const sidebarWidth = dimensions().width > 120 ? 42 : 0
    return dimensions().width - sidebarWidth < 100
  })

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
              <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={narrow() ? 1 : 0}>
                {Flag.AX_CODE_EXPERIMENTAL_WORKSPACES ? (
                  <box flexDirection="column">
                    <text fg={theme.text}>
                      <b>Subagent session</b>
                    </text>
                    <WorkspaceInfo workspace={workspace} />
                  </box>
                ) : (
                  <text fg={theme.text}>
                    <b>Subagent session</b>
                  </text>
                )}

                <ContextInfo context={context} />
              </box>
              <box flexDirection="row" gap={2}>
                <box
                  onMouseOver={() => setHover("parent")}
                  onMouseOut={() => setHover(null)}
                  onMouseUp={() => command.trigger("session.parent")}
                  backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.primary}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={hover() === "parent" ? theme.text : theme.background}>
                    Back to Parent{" "}
                    <span style={{ fg: hover() === "parent" ? theme.textMuted : theme.background }}>
                      {keybind.print("session_parent")}
                    </span>
                  </text>
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
            <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={1}>
              {Flag.AX_CODE_EXPERIMENTAL_WORKSPACES ? (
                <box flexDirection="column">
                  <Title session={session} />
                  <WorkspaceInfo workspace={workspace} />
                </box>
              ) : (
                <Title session={session} />
              )}
              <ContextInfo context={context} />
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
