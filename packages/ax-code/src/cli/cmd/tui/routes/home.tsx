// Home route — transitional per ADR-035 (Lean TUI / Rich Desktop Boundary).
//
// This route is kept as a backward-compat alias. The default startup path
// resolves to a session or new-session route via the launch policy (see
// navigation/launch-policy.ts). Dashboard/workflow supervision ownership moves
// to AX Code Desktop.
//
// TODO(ADR-035): Re-evaluate whether this backward-compatibility route is still needed.

import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, For, Match, on, onMount, Show, Switch } from "solid-js"
import { useTerminalDimensions } from "@ax-code/tui/solid"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { ModeChips } from "../component/mode-chips"
import { useCommandDialog } from "../component/dialog-command"
import { recentSessions, recentSessionTitle } from "../component/session-picker-view-model"
import { homeStatusBarLayout, homeStatusBarMcpWidth } from "./home-layout"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast, useToast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useKeybind } from "../context/keybind"
import { usePromptRef } from "../context/prompt"
import { useKV } from "../context/kv"
import { Installation } from "@/installation"
import { useLocal } from "../context/local"
import { WorkMode } from "@/mode/work-mode"
import { recordTuiStartupOnce } from "@tui/util/startup-trace"
import { isNonEmptyRecord } from "@/util/record"
import { stringWidth } from "@/bun/node-compat"

// --prompt must fire exactly once per process: Home remounts on every return
// to the home route (/new, session deletion), so a per-mount flag would
// re-inject and auto-resubmit the CLI prompt — spawning a fresh agent run —
// on every Home visit.
let startupPromptConsumed = false
// Apply Agent work-mode default only once per process on first Home entry.
// Home remounts (e.g. clearing initialPrompt) must not wipe a mode the user
// just selected on the new-chat surface. /new and session-delete still reset.
let homeDefaultWorkModeApplied = false

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const nav = useRoute()
  const keybind = useKeybind()
  const route = useRouteData("home")
  const sdk = useSDK()
  const kv = useKV()
  // Reset the pinned workspace when landing on Home. A session route pins
  // `sdk.setWorkspace(session.directory)`; without this, that pin would leak and
  // a new session started from Home would be created in the previous session's
  // workspace instead of the one Home is showing. Mirrors the session route.
  createEffect(() => sdk.setWorkspace(route.workspaceID))
  // Cold-start Home: default to Agent once (overrides sticky kv from prior runs).
  onMount(() => {
    if (homeDefaultWorkModeApplied) return
    homeDefaultWorkModeApplied = true
    kv.set("work_mode", WorkMode.DEFAULT)
  })
  const promptRef = usePromptRef()
  const args = useArgs()
  const local = useLocal()
  const toast = useToast()
  const command = useCommandDialog()
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
  onMount(() => {
    recordTuiStartupOnce("tui.startup.homeMounted", { hasPrompt: !!args.prompt })
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      // Consume-once: clear the prompt from the route so it isn't re-injected
      // on the next Home mount or leaked into a later navigation.
      nav.navigate({ type: "home", workspaceID: route.workspaceID })
    } else if (args.prompt && !startupPromptConsumed) {
      prompt.set({ input: args.prompt, parts: [] })
    }
  })

  // Wait for providers and model state to settle before auto-submitting --prompt.
  createEffect(
    on(
      () => sync.data.provider_loaded && local.model.ready && !!local.model.current(),
      (ready) => {
        if (!ready) return
        recordTuiStartupOnce("tui.startup.homePromptReady")
        if (!args.prompt || startupPromptConsumed) return
        if (prompt.current?.input !== args.prompt) return
        startupPromptConsumed = true
        prompt.submit()
      },
    ),
  )
  // The effect above waits forever when providers fail to load — the prompt
  // would vanish silently. Surface the failure instead; the text stays in the
  // input so the user can retry manually after fixing provider config.
  createEffect(
    on(
      () => sync.data.provider_failed,
      (failed) => {
        if (!failed) return
        if (!args.prompt || startupPromptConsumed) return
        startupPromptConsumed = true
        process.exitCode = 1
        recordTuiStartupOnce("tui.startup.homePromptProviderFailed")
        toast.show({
          variant: "error",
          message: "Providers failed to load — could not auto-submit the --prompt argument",
          duration: 8000,
        })
      },
    ),
  )
  const directory = useDirectory()
  const dimensions = useTerminalDimensions()
  // The bottom bar stacks vertically once its segments no longer fit on one
  // line (promptFooterLayout-style degradation; the math lives in home-layout).
  const statusBarLayout = createMemo(() =>
    homeStatusBarLayout({
      terminalWidth: dimensions().width,
      segmentWidths: [
        stringWidth(directory()),
        mcp() ? homeStatusBarMcpWidth(connectedMcpCount()) : 0,
        stringWidth(Installation.VERSION),
      ],
    }),
  )

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
            <box flexDirection="row" flexShrink={0}>
              <text fg={theme.textMuted} selectable={false}>
                {agentLabel()} ·{" "}
              </text>
              {/* Clicking the model name opens the model picker via the same
                  registered-command path as the model_list keybind. The handler
                  lives on the wrapping box, never on <text> (see ModeChips). */}
              <box flexShrink={0} onMouseUp={() => command.trigger("model.list")}>
                <text fg={theme.textMuted} selectable={false}>
                  {local.model.parsed().model}
                </text>
              </box>
              <text fg={theme.textMuted} selectable={false} flexShrink={1}>
                {" "}
                · {directory()}
              </text>
            </box>
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
            footerRight={<ModeChips />}
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
              <span style={{ fg: theme.text }}>@</span>
              <span style={{ fg: theme.textMuted }}> · attach files and invoke subagents</span>
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
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection={statusBarLayout().stacked ? "column" : "row"}
        justifyContent={statusBarLayout().stacked ? "flex-start" : "space-between"}
        flexShrink={0}
        gap={statusBarLayout().stacked ? 1 : 2}
      >
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
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
