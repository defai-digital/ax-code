// Home route — transitional per ADR-035 (Lean TUI / Rich Desktop Boundary).
//
// This route is kept as a backward-compat alias during OpenTUI deprecation.
// After Ratatui promotion, the default startup path will always resolve to a
// session or new-session route via the launch policy (see navigation/launch-policy.ts).
// Dashboard/workflow supervision ownership moves to AX Code Desktop.
//
// TODO(ADR-035 Phase 5): Remove or archive this route after Ratatui becomes the
// default stable CLI path and the OpenTUI fallback window expires.

import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, For, Match, on, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { recentSessions, recentSessionTitle } from "../component/session-picker-view-model"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { useKeybind } from "../context/keybind"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useLocal } from "../context/local"
import { recordTuiStartupOnce } from "@tui/util/startup-trace"
import { isNonEmptyRecord } from "@/util/record"

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const nav = useRoute()
  const keybind = useKeybind()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const args = useArgs()
  const local = useLocal()
  const mcp = createMemo(() => isNonEmptyRecord(sync.data.mcp))
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const modelLoading = createMemo(
    () => !sync.data.provider_failed && (!sync.data.provider_loaded || !local.model.ready),
  )
  const recent = createMemo(() => recentSessions(sync.data.session))
  const agentLabel = createMemo(() => {
    const agent = local.agent.current()
    return agent.displayName ?? Locale.titlecase(agent.name)
  })

  const Hint = (
    <Switch>
      <Match when={modelLoading()}>
        <box flexShrink={0} flexDirection="row" gap={1}>
          <text fg={theme.warning}>
            <span style={{ fg: theme.warning }}>•</span> Provider is loading{" "}
            <span style={{ fg: theme.textMuted }}>· please wait about 10 seconds while models initialize</span>
          </text>
        </box>
      </Match>
      <Match when={connectedMcpCount() > 0}>
        <box flexShrink={0} flexDirection="row" gap={1}>
          <text fg={theme.text}>
            <Switch>
              <Match when={mcpError()}>
                <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
                <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
              </Match>
              <Match when={true}>
                <span style={{ fg: theme.success }}>•</span>{" "}
                {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
              </Match>
            </Switch>
          </text>
        </box>
      </Match>
    </Switch>
  )

  let prompt: PromptRef
  let once = false
  onMount(() => {
    recordTuiStartupOnce("tui.startup.homeMounted", { hasPrompt: !!args.prompt })
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })

  // Wait for providers and model state to settle before auto-submitting --prompt.
  createEffect(
    on(
      () => sync.data.provider_loaded && local.model.ready && !!local.model.current(),
      (ready) => {
        if (!ready) return
        recordTuiStartupOnce("tui.startup.homePromptReady")
        if (!args.prompt) return
        if (prompt.current?.input !== args.prompt) return
        prompt.submit()
      },
    ),
  )
  const directory = useDirectory()

  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={4} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>
          <Logo />
        </box>
        <Show when={!modelLoading()}>
          <box flexShrink={0} maxWidth={75} paddingTop={1}>
            <text fg={theme.textMuted} selectable={false}>
              {agentLabel()} · {local.model.parsed().model} · {directory()}
            </text>
          </box>
        </Show>
        <box height={1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            workspaceID={route.workspaceID}
          />
        </box>
        <Show when={isFirstTimeUser()}>
          <box
            flexDirection="column"
            alignItems="flex-start"
            flexShrink={0}
            maxWidth={75}
            paddingLeft={2}
            paddingRight={2}
          >
            <text>
              <span style={{ fg: theme.accent }}>●</span>
              {"  "}
              <span style={{ fg: theme.text }}>Ask anything</span>
              <span style={{ fg: theme.textMuted }}> · just type your question</span>
            </text>
            <text>
              <span style={{ fg: theme.accent }}>●</span>
              {"  "}
              <span style={{ fg: theme.text }}>/help</span>
              <span style={{ fg: theme.textMuted }}> · keyboard shortcuts and commands</span>
            </text>
            <text>
              <span style={{ fg: theme.accent }}>●</span>
              {"  "}
              <span style={{ fg: theme.text }}>@filename</span>
              <span style={{ fg: theme.textMuted }}> · attach files from your project</span>
            </text>
          </box>
        </Show>
        <Show when={!isFirstTimeUser() && recent().length > 0}>
          <box
            flexDirection="column"
            alignItems="flex-start"
            flexShrink={0}
            width="100%"
            maxWidth={75}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
          >
            <For each={recent()}>
              {(session) => (
                <box flexDirection="row" onMouseUp={() => nav.navigate({ type: "session", sessionID: session.id })}>
                  <text selectable={false}>
                    <span style={{ fg: theme.accent }}>●</span>
                    {"  "}
                    <span style={{ fg: theme.text }}>{recentSessionTitle(session)}</span>
                    <span style={{ fg: theme.textMuted }}> {Locale.todayTimeOrDateTime(session.time.updated)}</span>
                  </text>
                </box>
              )}
            </For>
            <text fg={theme.textMuted} selectable={false}>
              {"   "}click to resume · /sessions or {keybind.print("session_list")} for all
            </text>
          </box>
        </Show>
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>● </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>● </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
