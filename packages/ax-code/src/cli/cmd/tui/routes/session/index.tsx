import {
  createEffect,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { Chip } from "@tui/ui/primitives/chip"
import { selectedForeground, tint, useTheme } from "@tui/context/theme"
import {
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
  RGBA,
} from "@ax-code/opentui-core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@ax-code/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@ax-code/opentui-solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import {
  findRenderableChild,
  focusRenderable,
  isRenderableAlive,
  renderableChildren,
} from "@tui/util/renderable-safety"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { Header } from "./header"
import { useDialog } from "../../ui/dialog"
import { DialogMessage } from "./dialog-message"
import { DialogActivity } from "./dialog-activity"
import { DialogCapabilityCatalog } from "./dialog-capability-catalog"
import { DialogTimeline } from "./dialog-timeline"
import { DialogQuality } from "./dialog-quality"
import { DialogWorkflow } from "./dialog-workflow"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { DialogDre } from "./dialog-dre"
import { DialogDreGraph } from "./dialog-dre-graph"
import { DialogGoal } from "./dialog-goal"
import { DialogBranch } from "./dialog-branch"
import { DialogCompare } from "./dialog-compare"
import { DialogRollback } from "./dialog-rollback"
import { DialogDiffViewer } from "../../component/dialog-diff-viewer"
import { SessionRollbackView } from "./rollback"
import { Sidebar } from "./sidebar"
import { sessionQualityActions, sessionQualityActionValue } from "./quality"
import { computeSessionMainPaneWidth } from "./layout"
import { Flag } from "@/flag/flag"
import parsers from "../../../../../../parsers-config.ts"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { UI } from "@/cli/ui.ts"
import { useTuiConfig } from "../../context/tui-config"
import { coalesceParts, type DisplayPart } from "./coalesce"
import { autonomousActiveView, isAutonomousProducedMessage, isLiveAutonomousText } from "./autonomous-active"
import { useAutonomousPulse } from "./autonomous-pulse"
import { footerSessionStatusOrIdle } from "./footer-view-model"
import { childAction, firstChildID, nextChildID } from "./child"
import { lastUserMessageID, promptState, redoMessageID, undoMessageID } from "./messages"
import { messageScroll, messageTarget, nextVisibleMessage } from "./navigation"
import { RevertNotice } from "./revert-notice"
import { revertState, hiddenMessageIDs } from "./revert"
import { displayCommands } from "./display-commands"
import { userRoute } from "../../util/transcript"
import { EventQuery } from "@/replay/query"
import { routeEvent } from "./route"
import {
  assistantMessageDuration,
  assistantToolSummary,
  codeDisplayView,
  compactDelegatedLabel,
  userMessageMetadataDensity,
} from "./view-model"
import { SessionCodeRenderer } from "./render-adapter"
import { Log } from "@/util/log"
import { firstCompactionMessageID, shouldShowCompactionNotice } from "./compaction-view-model"
import { createReconnectRecoveryGate } from "../../util/reconnect-recovery"
import { recordTuiStartupOnce } from "@tui/util/startup-trace"
import { isMissingSessionSnapshotError } from "../../context/sync-session-coordinator"
import {
  createSessionEntrySyncRetryState,
  nextSessionEntrySyncRetry,
  type SessionEntrySyncRetryState,
} from "./entry-sync"
import { buildSubagentStatusView, type SubagentRollupTask } from "./subagent-status-view"
import { SessionRouteContext as context, useSessionRouteContext as use } from "./context"
import { coalescedToolLabel } from "./tool-rendering"
import { toolRendererComponent } from "./tool-renderers"

addDefaultParsers(parsers.parsers)

const log = Log.create({ service: "tui.session" })

type ScrollChild = {
  id?: string
  y: number
}

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

export function Session() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const { theme } = useTheme()
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const risk = createMemo(() => sync.session.risk(route.sessionID))
  // Mirror of the header's autonomous chip — same SessionStatus source —
  // so the transcript outer border and the header chip flip together.
  const autonomous = createMemo(() => {
    const candidate = sync.data.session_status?.[route.sessionID]
    return autonomousActiveView(footerSessionStatusOrIdle(candidate))
  })
  // Breathing pulse for the transcript's outer border while the
  // autonomous turn is running. Same driver as the assistant text
  // bubble and the header chip, so the three visual cues breathe
  // together. Border color is interpolated between a dim and full
  // theme.accent so the existing "this is autonomous" hue is
  // preserved — we only modulate brightness.
  const autonomousBorderPulse = useAutonomousPulse(() => autonomous().active, {
    animationsEnabled: () => kv.get("animations_enabled", true),
  })
  const autonomousBorderColor = createMemo(() => {
    const MIN_ALPHA = 0.45
    const MAX_ALPHA = 1.0
    const alpha = MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * autonomousBorderPulse()
    return tint(theme.background, theme.accent, alpha)
  })
  const qualityActions = createMemo(() =>
    sessionQualityActions({
      sessionID: route.sessionID,
      quality: risk()?.quality,
    }),
  )
  const hasQualityReadiness = createMemo(() => qualityActions().length > 0)
  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const subagentTasks = createMemo(() => {
    const sessionMessages = sync.data.message[route.sessionID] ?? []
    const tasks: SubagentRollupTask[] = []
    for (const message of sessionMessages) {
      const parts = sync.data.part[message.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool" || (part as any).tool !== "task") continue
        const state = (part as any).state ?? {}
        const status = state.status
        const input = state.input ?? {}
        const metadata = state.metadata ?? {}
        const sessionID = metadata.sessionId ?? metadata.sessionID ?? input.task_id
        tasks.push({
          id: part.id,
          sessionID: typeof sessionID === "string" ? sessionID : undefined,
          title: state.title ?? input.description,
          agent: input.subagent_type,
          status,
          startedAt: state.time?.start,
          lastActivityAt: state.time?.end ?? state.time?.start,
        })
      }
    }

    const parentID = session()?.parentID ?? route.sessionID
    return buildSubagentStatusView({
      tasks,
      childSessions: children(),
      statuses: sync.data.session_status,
      parentSessionID: parentID,
    })
  })
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })

  const messagesWithParts = createMemo(() =>
    messages().map((item) => ({
      info: item,
      parts: sync.data.part[item.id] ?? [],
    })),
  )

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  // Default to auto-showing the sidebar on wide terminals. Narrow terminals
  // still use the overlay path when the user explicitly toggles it.
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [metadataDensity, setMetadataDensity] = kv.signal<"auto" | "full" | "compact">(
    "user_message_metadata_density",
    "auto",
  )
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", true)
  const [showHeader, setShowHeader] = kv.signal("header_visible", true)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)
  const [statusTick, setStatusTick] = createSignal(0)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  // "Visible" includes the narrow-mode overlay (used for the render
  // gate). "Panel" means the sidebar is rendered as a side column that
  // reduces the main pane's width — only true when also `wide()`.
  // Layout math (main pane, prompt) must use the panel signal so the
  // prompt isn't shrunk when the sidebar is floating as an overlay.
  const sidebarPanelVisible = createMemo(() => sidebarVisible() && wide())
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() =>
    computeSessionMainPaneWidth({
      terminalWidth: dimensions().width,
      sidebarVisible: sidebarPanelVisible(),
    }),
  )

  onMount(() => {
    recordTuiStartupOnce("tui.startup.sessionMounted")
  })

  createEffect(() => {
    const sessionID = route.sessionID
    const cancel = scheduleTuiInterval(
      () => {
        const candidate = sync.data.session_status?.[sessionID]
        if (footerSessionStatusOrIdle(candidate).type === "idle") return
        setStatusTick((value) => value + 1)
      },
      {
        name: "session-status-tick",
        delayMs: 1000,
        unref: true,
      },
    )
    onCleanup(cancel)
  })

  const scrollAcceleration = createMemo(() => {
    const tui = tuiConfig
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })

  const toast = useToast()
  const sdk = useSDK()
  createEffect(() => {
    sdk.setWorkspace(session()?.directory)
  })

  let sessionSyncGeneration = 0
  const sessionSyncRetryTimers = new Set<() => void>()

  function scheduleSessionSyncRetry(fn: () => void, delay: number) {
    const cancel = scheduleTuiTimeout(
      () => {
        sessionSyncRetryTimers.delete(cancel)
        fn()
      },
      {
        name: "session-sync-retry",
        delayMs: delay,
        unref: true,
      },
    )
    sessionSyncRetryTimers.add(cancel)
  }

  function runInitialSessionSync(
    sessionID: string,
    generation: number,
    retryState: SessionEntrySyncRetryState,
    attempt = 1,
  ) {
    void sync.session
      .sync(sessionID, { missing: "throw" })
      .then(() => {
        if (generation !== sessionSyncGeneration) return
        toBottom()
      })
      .catch((error) => {
        if (generation !== sessionSyncGeneration) return
        if (isMissingSessionSnapshotError(error)) {
          const nextRetry = nextSessionEntrySyncRetry(retryState)
          if (nextRetry) {
            scheduleSessionSyncRetry(
              () => runInitialSessionSync(sessionID, generation, nextRetry.state, attempt + 1),
              nextRetry.delayMs,
            )
            return
          }
        }
        log.warn("session sync failed", { error, sessionID, attempt })
        toast.show({
          message: `Failed to load session: ${sessionID}`,
          variant: "error",
        })
        navigate({ type: "home" })
      })
  }

  createEffect(
    on(
      () => route.sessionID,
      (sessionID) => {
        const generation = ++sessionSyncGeneration
        runInitialSessionSync(sessionID, generation, createSessionEntrySyncRetryState())
      },
    ),
  )
  onCleanup(() => {
    sessionSyncGeneration++
    for (const cancel of sessionSyncRetryTimers) cancel()
    sessionSyncRetryTimers.clear()
  })

  const reconnectSession = createReconnectRecoveryGate({
    recover: () =>
      sync.session.sync(route.sessionID, { force: true, missing: "throw" }).catch((error) => {
        log.warn("session resync after reconnect failed", { error, sessionID: route.sessionID })
        toast.show({
          message: "Reconnected, but refreshing the session state failed",
          variant: "error",
        })
      }),
  })
  createEffect(
    on(
      () => sdk.sseConnected,
      (connected) => reconnectSession.onConnectionChange(connected),
    ),
  )
  onCleanup(() => reconnectSession.dispose())

  // plan_exit hands off to the build agent. Sync the picker so the chip
  // matches the synthetic user message the tool created.
  let lastSwitch: string | undefined = undefined
  const unsubAgentSwitch = sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return
    if (part.sessionID !== route.sessionID) return
    if (part.state.status !== "completed") return
    if (part.id === lastSwitch) return
    if (part.tool !== "plan_exit") return
    local.agent.set("build")
    lastSwitch = part.id
  })
  onCleanup(() => unsubAgentSwitch())

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()
  const dialog = useDialog()
  const renderer = useRenderer()

  // Allow exit when in child session (prompt is hidden)
  const exit = useExit()

  // Double-click anywhere in a subagent transcript jumps back to the
  // parent session — mirrors the existing header double-click but
  // covers the full screen so users don't have to drag focus back up
  // to the title row. Matches the same SUBAGENT_PARENT_DOUBLE_CLICK_MS
  // window the header uses. Skipped while a text selection is active so
  // a user finishing a drag-select isn't bounced out unexpectedly.
  const SUBAGENT_BODY_DOUBLE_CLICK_MS = 400
  let lastSubagentBodyClickAt = 0
  function handleSubagentBodyMouseUp() {
    if (!session()?.parentID) return
    if (renderer.getSelection()?.getSelectedText()) return
    const now = Date.now()
    if (now - lastSubagentBodyClickAt <= SUBAGENT_BODY_DOUBLE_CLICK_MS) {
      lastSubagentBodyClickAt = 0
      const parentID = session()?.parentID
      if (parentID) navigate({ type: "session", sessionID: parentID })
      return
    }
    lastSubagentBodyClickAt = now
  }

  createEffect(() => {
    const currentSession = session()
    const title = Locale.truncate(currentSession?.title ?? "", 50)
    const pad = (text: string) => text.padEnd(10, " ")
    const weak = (text: string) => UI.Style.TEXT_DIM + pad(text) + UI.Style.TEXT_NORMAL
    const logo = UI.logo("  ").split(/\r?\n/)
    return exit.message.set(
      [
        ...logo,
        ``,
        `  ${weak("Session")}${UI.Style.TEXT_NORMAL_BOLD}${title}${UI.Style.TEXT_NORMAL}`,
        currentSession?.id
          ? `  ${weak("Continue")}${UI.Style.TEXT_NORMAL_BOLD}ax-code -s ${currentSession.id}${UI.Style.TEXT_NORMAL}`
          : undefined,
        ``,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    )
  })

  useKeyboard((evt) => {
    if (!session()?.parentID) return
    if (keybind.match("app_exit", evt)) {
      exit()
    }
  })

  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    if (!isRenderableAlive(scroll)) return
    const children = renderableChildren<ScrollChild>(scroll, { name: "session-scroll-message-children" })
    const targetID = nextVisibleMessage({
      direction,
      children,
      messages: messages(),
      parts: sync.data.part,
      scrollTop: scroll.y,
    })
    const child = targetID
      ? findRenderableChild<ScrollChild>(scroll, (item) => item.id === targetID, {
          name: "session-scroll-message-target",
        })
      : undefined
    scroll.scrollBy(
      messageScroll({
        direction,
        target: child,
        scrollTop: scroll.y,
        height: scroll.height,
      }),
    )
    dialog.clear()
  }

  let cancelScrollTimer: (() => void) | undefined
  function toBottom() {
    cancelScrollTimer?.()
    cancelScrollTimer = scheduleTuiTimeout(
      () => {
        cancelScrollTimer = undefined
        if (!isRenderableAlive(scroll)) return
        scroll.scrollTo(scroll.scrollHeight)
      },
      {
        name: "session-scroll-to-bottom",
        delayMs: 50,
      },
    )
  }
  onCleanup(() => cancelScrollTimer?.())

  const local = useLocal()

  function moveFirstChild() {
    const next = firstChildID(children())
    if (next) {
      navigate({
        type: "session",
        sessionID: next,
      })
    }
  }

  function moveChild(direction: number) {
    const next = nextChildID(children(), session()?.id, direction)
    if (next) {
      navigate({
        type: "session",
        sessionID: next,
      })
    }
  }

  function childSessionHandler(func: (dialog: DialogContext) => void) {
    return (dialog: DialogContext) => {
      if (!childAction(session()?.parentID, dialog.stack.length)) return
      func(dialog)
    }
  }

  function continueBranch(sessionID: string) {
    navigate({
      type: "session",
      sessionID,
    })
    scheduleMicrotaskTask(
      () => {
        focusRenderable(promptRef.current, { name: "session-continue-branch-focus" })
      },
      {
        name: "session-continue-branch-focus",
      },
    )
  }

  const command = useCommandDialog()
  command.register(() => [
    ...displayCommands({
      conceal,
      currentModel: () => local.model.current(),
      dialogReplaceActivity: (dialog) => dialog.replace(() => <DialogActivity sessionID={route.sessionID} />),
      dialogReplaceCapability: (dialog) => dialog.replace(() => <DialogCapabilityCatalog />),
      dialogReplaceDre: (dialog) => dialog.replace(() => <DialogDre sessionID={route.sessionID} />),
      dialogReplaceDreGraph: (dialog) => dialog.replace(() => <DialogDreGraph sessionID={route.sessionID} />),
      dialogReplaceGoal: (dialog) =>
        dialog.replace(() => (
          <DialogGoal
            goal={sync.data.session_goal[route.sessionID]}
            setPrompt={(value) => {
              prompt.set({ input: value, parts: [] })
              focusRenderable(prompt, { name: "session-goal-prompt-focus" })
            }}
          />
        )),
      dialogReplaceQuality: (dialog) =>
        dialog.replace(() => (
          <DialogQuality
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => {
              if (!prompt) return
              prompt.set(promptInfo)
              focusRenderable(prompt, { name: "session-quality-prompt-focus" })
            }}
          />
        )),
      dialogReplaceWorkflow: (dialog) => dialog.replace(() => <DialogWorkflow />),
      dialogReplaceBranch: (dialog) =>
        dialog.replace(() => (
          <DialogBranch
            currentID={route.sessionID}
            sessions={children().map((item) => ({ id: item.id, title: item.title }))}
            onSelect={(sessionID) => navigate({ type: "session", sessionID })}
            onContinue={continueBranch}
          />
        )),
      dialogReplaceCompare: (dialog) =>
        dialog.replace(() => (
          <DialogCompare
            currentID={route.sessionID}
            sessions={children().map((item) => ({ id: item.id, title: item.title }))}
          />
        )),
      dialogReplaceRollback: (dialog) =>
        dialog.replace(() => (
          <DialogRollback
            sessionID={route.sessionID}
            messages={messagesWithParts()}
            onSelect={async (point) => {
              // The v2 SDK client resolves `{error}` instead of rejecting, so
              // both calls must check the result — a failed abort or revert
              // would otherwise fall through to the success path and clobber
              // the typed prompt while the server never reverted. Thrown
              // errors are toasted by DialogRollback, which keeps the dialog
              // open for retry.
              const status = sync.data.session_status?.[route.sessionID]
              if (status?.type !== "idle") {
                const aborted = await sdk.client.session.abort({ sessionID: route.sessionID })
                if (aborted.error) {
                  log.warn("session rollback abort failed", { error: aborted.error, sessionID: route.sessionID })
                  throw new Error(
                    sdkErrorMessage(aborted.error, "Failed to stop the running session before rollback"),
                  )
                }
              }
              const result = await sdk.client.session.revert({
                sessionID: route.sessionID,
                messageID: point.messageID,
                partID: point.partID,
              })
              if (result.error) {
                log.warn("session rollback revert failed", { error: result.error, sessionID: route.sessionID })
                throw new Error(sdkErrorMessage(result.error, "Failed to rollback to selected step"))
              }
              const messageID = SessionRollbackView.promptID(messagesWithParts(), point)
              if (messageID) prompt.set(promptState(sync.data.part[messageID] ?? []))
              toBottom()
            }}
          />
        )),
      children,
      dialogReplaceDiffViewer: (dialog) => dialog.replace(() => <DialogDiffViewer sessionID={route.sessionID} />),
      dialogReplaceTimeline: (dialog) =>
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = messageTarget(
                renderableChildren<ScrollChild>(scroll, { name: "session-timeline-message-children" }),
                messageID,
              )
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt.set(promptInfo)}
          />
        )),
      dialogReplaceFork: (dialog) =>
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const child = messageTarget(
                renderableChildren<ScrollChild>(scroll, { name: "session-fork-message-children" }),
                messageID,
              )
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        )),
      dialogReplaceRename: (dialog) => dialog.replace(() => <DialogSessionRename session={route.sessionID} />),
      jumpToLastUser: () => {
        const list = sync.data.message[route.sessionID] ?? []
        const id = lastUserMessageID(list, sync.data.part)
        const child = messageTarget(
          renderableChildren<ScrollChild>(scroll, { name: "session-last-user-message-children" }),
          id,
        )
        if (child) scroll.scrollBy(child.y - scroll.y - 1)
      },
      messages,
      parts: sync.data.part,
      renderer,
      routeSessionID: route.sessionID,
      scroll,
      scrollToMessage,
      sdk,
      session,
      setConceal,
      setShowDetails,
      setShowGenericToolOutput,
      setShowHeader,
      setShowScrollbar,
      setShowThinking,
      setSidebar,
      setSidebarOpen,
      setMetadataDensity: (next) => setMetadataDensity(() => next),
      setTimestamps,
      metadataDensity,
      showAssistantMetadata,
      showDetails,
      showGenericToolOutput,
      showHeader,
      showScrollbar,
      showThinking,
      showTimestamps,
      sidebarVisible,
      agents: sync.data.agent,
      hasQualityReadiness,
      workflowRuntimeEnabled: Flag.AX_CODE_WORKFLOW_RUNTIME,
      suggested: route.type === "session",
      toast,
    }),
    ...qualityActions().map((action) => ({
      title: action.title,
      value: sessionQualityActionValue(action),
      category: "Quality",
      onSelect: (dialog: DialogContext) => {
        if (prompt) {
          prompt.set(action.prompt)
          focusRenderable(prompt, { name: "session-quality-action-prompt-focus" })
        }
        dialog.clear()
      },
    })),
    // ─── Debugging & Refactoring Engine slash commands ─────────────
    //
    // Gated on AX_CODE_EXPERIMENTAL_DEBUG_ENGINE so users who haven't
    // opted into DRE don't see orphaned commands in the palette.
    // Each command scaffolds a prompt message the user can customize
    // before sending — this is cheaper than a bespoke dialog per tool
    // and still discoverable via the command palette.
    {
      title: "Debug an error (DRE)",
      value: "debug.analyze",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Debug this error using debug_analyze. Paste the error message and stack trace after this line.\n\nError: ",
          parts: [],
        })
        focusRenderable(promptRef.current, { name: "session-dre-debug-prompt-focus" })
        dialog.clear()
      },
    },
    {
      title: "Analyze change impact (DRE)",
      value: "debug.impact",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Use impact_analyze to show the blast radius of changing <symbol or file>. Report the risk label before making any edits.",
          parts: [],
        })
        focusRenderable(promptRef.current, { name: "session-dre-impact-prompt-focus" })
        dialog.clear()
      },
    },
    {
      title: "Find duplicate code (DRE)",
      value: "debug.dedup",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      onSelect: (dialog) => {
        promptRef.current?.set({
          input: "Run dedup_scan on this project and report the top clusters ranked by extraction value.",
          parts: [],
        })
        focusRenderable(promptRef.current, { name: "session-dre-dedup-prompt-focus" })
        dialog.clear()
      },
    },
    {
      title: "Scan for hardcoded values (DRE)",
      value: "debug.hardcode",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Run hardcode_scan and list findings grouped by severity. Focus on inline_secret_shape and inline_url first.",
          parts: [],
        })
        focusRenderable(promptRef.current, { name: "session-dre-hardcode-prompt-focus" })
        dialog.clear()
      },
    },
    {
      title: "Plan a refactor (DRE)",
      value: "debug.refactor",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Use refactor_plan to draft a plan for <describe the refactor>. Do not apply anything until I review the plan.",
          parts: [],
        })
        focusRenderable(promptRef.current, { name: "session-dre-refactor-prompt-focus" })
        dialog.clear()
      },
    },
    {
      title: "List pending refactor plans (DRE)",
      value: "debug.plans",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      onSelect: (dialog) => {
        const plans = sync.data.debugEngine.plans
        if (plans.length === 0) {
          toast.show({
            message: "No pending refactor plans",
            variant: "success",
            duration: 3000,
          })
          dialog.clear()
          return
        }
        // Build a human-readable summary and drop it into the prompt
        // so the user can ask the agent to act on a specific plan.
        // A richer "select a plan to apply" dialog lands in a later
        // tier (see PRD-debug-refactor-engine-ui.md §Tier 3).
        const lines: string[] = [`Pending refactor plans (${plans.length}):`, ""]
        for (const p of plans) {
          lines.push(`- [${p.risk}] ${p.kind} — ${p.planId}`)
          lines.push(`  ${p.affectedFileCount} file(s), ${p.affectedSymbolCount} symbol(s)`)
        }
        lines.push("")
        lines.push("Which plan should we apply? Use refactor_apply with the planId.")
        promptRef.current?.set({
          input: lines.join("\n"),
          parts: [],
        })
        focusRenderable(promptRef.current, { name: "session-dre-plans-prompt-focus" })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      enabled: !!undoMessageID(messages(), session()?.revert?.messageID),
      slash: {
        name: "undo",
      },
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") {
          try {
            await sdk.client.session.abort({ sessionID: route.sessionID })
          } catch (error) {
            log.warn("session undo abort failed", { error, sessionID: route.sessionID })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to stop the running session before undo",
              variant: "error",
            })
            return
          }
        }
        const messageID = undoMessageID(messages(), session()?.revert?.messageID)
        if (!messageID) {
          dialog.clear()
          return
        }
        await sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID,
          })
          .then(() => {
            prompt.set(promptState(sync.data.part[messageID] ?? []))
            toBottom()
            dialog.clear()
          })
          .catch((error) => {
            log.warn("session undo failed", { error, sessionID: route.sessionID, messageID })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to undo previous message",
              variant: "error",
            })
          })
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      category: "Session",
      enabled: !!session()?.revert?.messageID,
      slash: {
        name: "redo",
      },
      onSelect: async (dialog) => {
        dialog.clear()
        const messageID = redoMessageID(messages(), session()?.revert?.messageID)
        if (!messageID) {
          await sdk.client.session
            .unrevert({
              sessionID: route.sessionID,
            })
            .then(() => {
              prompt.set({ input: "", parts: [] })
            })
            .catch((error) => {
              log.warn("session redo failed", { error, sessionID: route.sessionID })
              toast.show({
                message: error instanceof Error ? error.message : "Failed to redo the previous message",
                variant: "error",
              })
            })
          return
        }
        await sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID,
          })
          .catch((error) => {
            log.warn("session redo failed", { error, sessionID: route.sessionID, messageID })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to redo the previous message",
              variant: "error",
            })
          })
      },
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      keybind: "session_child_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        moveFirstChild()
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      onSelect: childSessionHandler((dialog) => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      }),
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      onSelect: childSessionHandler((dialog) => {
        moveChild(1)
        dialog.clear()
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      hidden: true,
      enabled: !!session()?.parentID,
      onSelect: childSessionHandler((dialog) => {
        moveChild(-1)
        dialog.clear()
      }),
    },
  ])

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revert = createMemo(() => revertState(revertInfo(), messages()))
  const hiddenIDs = createMemo(() => hiddenMessageIDs(messages(), revertMessageID()))
  const firstCompactionID = createMemo(() => firstCompactionMessageID(messages(), sync.data.part))
  const dismissedCompactionNotice = createMemo(() => {
    const dismissed = kv.get("compaction_notice_dismissed", {}) as Record<string, boolean>
    return !!dismissed[route.sessionID]
  })

  function dismissCompactionNotice() {
    const dismissed = kv.get("compaction_notice_dismissed", {}) as Record<string, boolean>
    kv.set("compaction_notice_dismissed", {
      ...dismissed,
      [route.sessionID]: true,
    })
  }

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  // Apply route.initialPrompt (fork, /new with a draft) on session→session
  // navigation. The Prompt ref callback below only runs on first mount, so
  // when the target session is already in the sync store (e.g. the SSE
  // session.created beat the fork response) the pre-filled prompt would be
  // dropped without this effect. Consume-once: clear it after applying so a
  // stale prompt can't leak into later navigations — route.navigate() merges
  // shallowly and never clears keys on its own.
  createEffect(
    on(
      () => route.sessionID,
      (sessionID) => {
        const initial = route.initialPrompt
        if (!initial) return
        // Prompt not mounted yet (session record still loading) — leave the
        // value for the ref callback to consume on first mount instead.
        if (!prompt) return
        prompt.set(initial)
        navigate({ type: "session", sessionID, initialPrompt: undefined })
      },
    ),
  )

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        sessionID: route.sessionID,
        conceal,
        showThinking,
        showTimestamps,
        showDetails,
        showGenericToolOutput,
        userMetadataPreference: metadataDensity,
        diffWrapMode,
        sync,
        tui: tuiConfig,
      }}
    >
      <box flexDirection="row">
        <box
          flexGrow={1}
          paddingBottom={1}
          paddingTop={1}
          paddingLeft={2}
          paddingRight={2}
          gap={1}
          border={autonomous().active || session()?.parentID ? ["left"] : undefined}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={autonomous().active ? autonomousBorderColor() : theme.primary}
          onMouseUp={handleSubagentBodyMouseUp}
        >
          <Show when={session()}>
            <Show when={showHeader() && (!sidebarVisible() || !wide())}>
              <Header />
            </Show>
            <Show when={subagentTasks().total > 0}>
              <box flexShrink={0} paddingLeft={1} gap={0}>
                <Show
                  when={subagentTasks().running > 0}
                  fallback={
                    <text fg={theme.textMuted}>
                      ◇ {Locale.pluralize(subagentTasks().total, "{} subagent", "{} subagents")}
                      {subagentTasks().done > 0 ? (
                        <span style={{ fg: theme.success }}> · {subagentTasks().done} done</span>
                      ) : null}
                    </text>
                  }
                >
                  <Spinner color={subagentTasks().items.some((item) => item.stale) ? theme.warning : theme.primary}>
                    <span>
                      {Locale.pluralize(subagentTasks().running, "{} subagent", "{} subagents")} active
                      {subagentTasks().done > 0 ? (
                        <span style={{ fg: theme.success }}> · {subagentTasks().done} done</span>
                      ) : null}
                    </span>
                  </Spinner>
                </Show>
                <For
                  each={subagentTasks()
                    .items.filter((item) => item.active)
                    .slice(0, 2)}
                >
                  {(item) => (
                    <text paddingLeft={3} fg={item.stale ? theme.warning : theme.textMuted}>
                      ↳ {item.label}
                    </text>
                  )}
                </For>
                <Show when={subagentTasks().items.filter((item) => item.active).length > 2}>
                  <text paddingLeft={3} fg={theme.textMuted}>
                    ↳ +{subagentTasks().items.filter((item) => item.active).length - 2} more active
                  </text>
                </Show>
              </box>
            </Show>
            <scrollbox
              ref={(r: ScrollBoxRenderable) => (scroll = r)}
              viewportOptions={{
                paddingRight: showScrollbar() ? 1 : 0,
              }}
              verticalScrollbarOptions={{
                paddingLeft: 1,
                visible: showScrollbar(),
                trackOptions: {
                  backgroundColor: theme.backgroundElement,
                  foregroundColor: theme.border,
                },
              }}
              stickyScroll={true}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <Show when={messages().length === 0 && !session()?.parentID}>
                <box flexGrow={1} alignItems="center" justifyContent="center" paddingTop={4} paddingBottom={2}>
                  <text>
                    <span style={{ fg: theme.accent }}>◦</span>
                    <span style={{ fg: theme.textMuted }}> Start typing to chat</span>
                  </text>
                  <text>
                    <span style={{ fg: theme.accent }}>◦</span>
                    <span style={{ fg: theme.textMuted }}> /help for commands</span>
                  </text>
                </box>
              </Show>
              <For each={messages()}>
                {(message, index) => (
                  <Switch>
                    <Match when={message.id === revert()?.messageID}>
                      <Show when={revert()}>
                        {(state) => <RevertNotice count={state().reverted.length} files={state().diffFiles} />}
                      </Show>
                    </Match>
                    <Match when={revert()?.messageID && hiddenIDs().has(message.id)}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
                      <>
                        <UserMessage
                          index={index()}
                          onMouseUp={() => {
                            if (renderer.getSelection()?.getSelectedText()) return
                            dialog.replace(() => (
                              <DialogMessage
                                messageID={message.id}
                                sessionID={route.sessionID}
                                setPrompt={(promptInfo) => prompt.set(promptInfo)}
                              />
                            ))
                          }}
                          message={message as UserMessage}
                          parts={sync.data.part[message.id] ?? []}
                          pending={pending()}
                          showCompactionNotice={shouldShowCompactionNotice({
                            currentMessageID: message.id,
                            firstMessageID: firstCompactionID(),
                            dismissed: dismissedCompactionNotice(),
                          })}
                          onDismissCompactionNotice={dismissCompactionNotice}
                        />
                        <RouteIndicator messageID={message.id} sessionID={route.sessionID} />
                      </>
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === message.id}
                        message={message as AssistantMessage}
                        parts={sync.data.part[message.id] ?? []}
                      />
                    </Match>
                  </Switch>
                )}
              </For>
            </scrollbox>
            <box flexShrink={0}>
              <Show when={permissions().length > 0}>
                <PermissionPrompt request={permissions()[0]} />
              </Show>
              <Show when={permissions().length === 0 && questions().length > 0}>
                <QuestionPrompt request={questions()[0]} />
              </Show>
              <Prompt
                sidebarVisible={sidebarPanelVisible}
                statusTick={statusTick}
                visible={!session()?.parentID && permissions().length === 0 && questions().length === 0}
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                  // Apply initial prompt when prompt component mounts (e.g., from fork)
                  if (route.initialPrompt) {
                    r.set(route.initialPrompt)
                  }
                }}
                disabled={permissions().length > 0 || questions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={route.sessionID} statusTick={statusTick} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
                onMouseDown={() => {
                  // Only dismiss the overlay; preserve the user's
                  // sidebar preference. Setting sidebar to "hide" here
                  // permanently disables the auto-show on resize, so a
                  // user who clicks the backdrop in narrow mode would
                  // never see the sidebar again after resizing wider.
                  setSidebarOpen(false)
                }}
              >
                <Sidebar sessionID={route.sessionID} overlay statusTick={statusTick} />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </context.Provider>
  )
}

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
  showCompactionNotice: boolean
  onDismissCompactionNotice: () => void
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => local.agent.color(props.message.agent))
  const queuedFg = createMemo(() => selectedForeground(theme, color()))
  const route = createMemo(() => userRoute(props.message, props.parts, sync.data.agent))
  const showPrimary = createMemo(() => props.message.agent !== "build" || route().delegated.length > 0)
  const metadataDensity = createMemo(() =>
    userMessageMetadataDensity({
      width: ctx.width,
      preference: ctx.userMetadataPreference(),
    }),
  )
  const compactDelegated = createMemo(() => compactDelegatedLabel(route().delegated.length))
  const metadataVisible = createMemo(
    () => queued() || ctx.showTimestamps() || showPrimary() || route().delegated.length > 0,
  )

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          border={["left"]}
          borderColor={color()}
          customBorderChars={SplitBorder.customBorderChars}
          marginTop={props.index === 0 ? 0 : 1}
        >
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <text marginBottom={1}>
              <span style={{ fg: color() }}>◆ </span>
              <span style={{ fg: theme.text }}>you</span>
            </text>
            <text fg={theme.text}>{text()?.text}</text>
            <Show when={files().length}>
              <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <Show when={metadataVisible()}>
              <Switch>
                <Match when={metadataDensity() === "compact"}>
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <Show when={showPrimary()}>
                      <text fg={theme.textMuted}>
                        <span style={{ fg: color() }}>●</span> {route().primary.label}
                      </text>
                    </Show>
                    <Show when={compactDelegated()}>
                      <text fg={theme.textMuted}>↳ {compactDelegated()}</text>
                    </Show>
                    <Show
                      when={queued()}
                      fallback={
                        <Show when={ctx.showTimestamps()}>
                          <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.message.time.created)}</text>
                        </Show>
                      }
                    >
                      <text fg={color()}>queued</text>
                    </Show>
                  </box>
                </Match>
                <Match when={true}>
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <Show when={showPrimary()}>
                      <text fg={theme.textMuted}>
                        <span style={{ bg: color(), fg: queuedFg(), bold: true }}> {route().primary.label} </span>
                      </text>
                    </Show>
                    <For each={route().delegated}>
                      {(item) => {
                        const bg = createMemo(() => local.agent.color(item.name))
                        const fg = createMemo(() => selectedForeground(theme, bg()))
                        return (
                          <text fg={theme.textMuted}>
                            <span style={{ bg: bg(), fg: fg(), bold: true }}> DELEGATED {item.label} </span>
                          </text>
                        )
                      }}
                    </For>
                    <Show
                      when={queued()}
                      fallback={
                        <Show when={ctx.showTimestamps()}>
                          <text fg={theme.textMuted}>
                            <span style={{ fg: theme.textMuted }}>
                              {Locale.todayTimeOrDateTime(props.message.time.created)}
                            </span>
                          </text>
                        </Show>
                      }
                    >
                      <text fg={theme.textMuted}>
                        <span style={{ bg: color(), fg: queuedFg(), bold: true }}> QUEUED </span>
                      </text>
                    </Show>
                  </box>
                </Match>
              </Switch>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        {(comp) => {
          const info = comp() as { auto: boolean; overflow?: boolean }
          const title = (info.auto ? "Auto compaction" : "Manual compaction") + (info.overflow ? " · overflow" : "")
          return (
            <box
              marginTop={1}
              border={["top"]}
              title={` ${title} `}
              titleAlignment="center"
              borderColor={theme.borderActive}
            />
          )
        }}
      </Show>
      <Show when={props.showCompactionNotice}>
        <CompactionNotice onDismiss={props.onDismissCompactionNotice} />
      </Show>
    </>
  )
}

function RouteIndicator(props: { messageID: string; sessionID: string }) {
  const { theme } = useTheme()
  const sync = useSync()

  const info = createMemo(() => {
    void sync.data.message[props.sessionID] // reactive: re-evaluate when messages update
    const sid = props.sessionID as Parameters<typeof EventQuery.bySessionWithTimestamp>[0]
    const rows = EventQuery.bySessionWithTimestamp(sid)
    const matches = rows.filter(
      (r) => r.event_data.type === "agent.route" && r.event_data.messageID === props.messageID,
    )
    if (matches.length === 0) return null
    // Prefer the switch event over a same-turn complexity event — the agent
    // change is more visually informative than the fast-model indicator.
    const primary =
      matches.find((r) => {
        const e = r.event_data
        return e.type === "agent.route" && e.routeMode !== "complexity"
      }) ?? matches[matches.length - 1]
    if (!primary) return null
    return routeEvent(primary, sync.data.agent)
  })

  return (
    <Show when={info()}>
      {(item) => (
        <box paddingLeft={4} paddingBottom={1} flexShrink={0}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.accent }}>{item().icon}</span>{" "}
            <span style={{ fg: theme.text }}>{item().title}</span>
            {" · "}
            <span style={{ fg: theme.textMuted }}>{item().detail}</span>
          </text>
        </box>
      )}
    </Show>
  )
}

function CompactionNotice(props: { onDismiss: () => void }) {
  const { theme } = useTheme()
  return (
    <box
      marginTop={1}
      border={["left"]}
      borderColor={theme.borderActive}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={theme.backgroundPanel}>
        <text fg={theme.text}>Session compacted to free context space.</text>
        <text fg={theme.textMuted}>Older messages were summarized. The session can continue normally.</text>
        <text fg={theme.textMuted} onMouseUp={props.onDismiss}>
          dismiss
        </text>
      </box>
    </box>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    return assistantMessageDuration(props.message, messages())
  })
  const toolSummary = createMemo(() => assistantToolSummary(props.parts))

  const keybind = useKeybind()

  const hasParts = createMemo(() => props.parts.length > 0)
  const isThinking = createMemo(() => !props.message.error && !hasParts() && !final() && props.last)
  // coalesceParts() fabricates new wrapper objects every run and <For> keys
  // rows by identity, so without caching every streamed part would recreate
  // ALL rows — resetting per-row expanded signals on single-part rows
  // mid-turn. Reuse the previous wrapper whenever its inputs are unchanged
  // (part store proxies are identity-stable unless the part itself was
  // replaced) so only genuinely-updated rows are recreated.
  let displayPartCache = new Map<string, DisplayPart>()
  const displayParts = createMemo(() => {
    const cache = new Map<string, DisplayPart>()
    const result = coalesceParts(props.parts).map((entry) => {
      const key = entry.kind === "single" ? `single:${entry.part.id}` : `coalesced:${entry.key}`
      const cached = displayPartCache.get(key)
      const stable = cached && sameDisplayPart(cached, entry) ? cached : entry
      cache.set(key, stable)
      return stable
    })
    displayPartCache = cache
    return result
  })
  // Coalesced-group expand state lives at message scope because a growing
  // run replaces its wrapper (the parts array changes); per-row state inside
  // CoalescedTool would reset every time a new tool call streamed in. Keyed
  // by the run's first callID so a growing run keeps its expanded/collapsed
  // state.
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set())
  const toggleGroup = (key: string, next: boolean) => {
    const current = expandedGroups()
    const updated = new Set(current)
    if (next) updated.add(key)
    else updated.delete(key)
    setExpandedGroups(updated)
  }

  return (
    <>
      <Show when={isThinking()}>
        <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1}>
          <Spinner color={theme.textMuted}>Thinking</Spinner>
        </box>
      </Show>
      <For each={displayParts()}>
        {(entry, index) => {
          const isLast = createMemo(() => index() === displayParts().length - 1)
          return (
            <Switch>
              <Match when={entry.kind === "coalesced" && entry}>
                {(group) => (
                  <CoalescedTool
                    group={group()}
                    message={props.message}
                    expanded={expandedGroups().has(group().key)}
                    onToggle={(next) => toggleGroup(group().key, next)}
                  />
                )}
              </Match>
              <Match when={entry.kind === "single" && entry}>
                {(single) => {
                  const component = createMemo(() => PART_MAPPING[single().part.type as keyof typeof PART_MAPPING])
                  return (
                    <Show when={component()}>
                      <Dynamic
                        last={isLast()}
                        component={component()}
                        part={single().part as any}
                        message={props.message}
                      />
                    </Show>
                  )
                }}
              </Match>
            </Switch>
          )
        }}
      </For>
      <Show when={props.parts.some((x) => x.type === "tool" && x.tool === "task")}>
        <box paddingTop={1} paddingLeft={3}>
          <text fg={theme.text}>
            {keybind.print("session_child_first")}
            <span style={{ fg: theme.textMuted }}> view subagents</span>
          </text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.text}>{String(props.message.error?.data?.message ?? "An error occurred")}</text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <box paddingLeft={3}>
            <text marginTop={1}>
              <span
                style={{
                  fg:
                    props.message.error?.name === "MessageAbortedError"
                      ? theme.textMuted
                      : local.agent.color(props.message.agent),
                }}
              >
                ◦{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>
                {sync.data.agent.find((a) => a.name === props.message.agent)?.displayName ??
                  Locale.titlecase(props.message.agent)}
              </span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <For each={toolSummary()}>
                {(item) => (
                  <span style={{ fg: theme.textMuted }}>
                    {" "}
                    · {item.count} {item.label}
                  </span>
                )}
              </For>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
      <Show when={!props.last && (final() || props.message.error)}>
        <box marginTop={2} marginLeft={3} marginRight={3} border={["top"]} borderColor={theme.borderSubtle} />
      </Show>
    </>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => {
    // Some providers send encrypted reasoning data that appears as [REDACTED].
    return props.part.text.replaceAll("[REDACTED]", "").trim()
  })
  const display = createMemo(() =>
    codeDisplayView({
      filePath: "thinking.md",
      content: "_Thinking:_ " + content(),
    }),
  )
  // Show while streaming even before first delta arrives (time.end undefined = still active)
  const visible = createMemo(() => (content() || props.part.time.end === undefined) && ctx.showThinking())
  return (
    <Show when={visible()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.borderSubtle}
      >
        <SessionCodeRenderer
          display={display()}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const [expanded, setExpanded] = createSignal(false)
  const trimmed = createMemo(() => props.part.text.trim())
  const lines = createMemo(() => trimmed().split("\n"))
  const isFinal = createMemo(() => !!props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish))
  // Only fold long completed text. Streaming text always renders in full.
  const overflow = createMemo(() => isFinal() && lines().length > 50)
  const visibleText = createMemo(() => {
    if (expanded() || !overflow()) return trimmed()
    return lines().slice(0, 50).join("\n") + "\n…"
  })

  // Autonomous-mode visual: in-flight text inside an active loop gets a
  // diff-add green background (max signal that the run is producing
  // output right now); once the turn settles, the background drops and
  // a thin green left-border stripe stays as a permanent "this answer
  // was autonomous-produced" marker. Both signals derive from a single
  // source (SessionStatus + the message's own step-finish-part count),
  // so they can't desync from the header chip or transcript border.
  const isLiveAutonomous = createMemo(() => {
    const candidate = ctx.sync.data.session_status?.[ctx.sessionID]
    return isLiveAutonomousText({
      last: props.last,
      message: props.message,
      autonomousActive: autonomousActiveView(footerSessionStatusOrIdle(candidate)).active,
    })
  })
  const isAutonomousProduced = createMemo(() => {
    const parts = ctx.sync.data.part[props.message.id] ?? []
    return isAutonomousProducedMessage(parts)
  })
  // Mutually exclusive — live wins while the turn is still running.
  const showStripe = createMemo(() => !isLiveAutonomous() && isAutonomousProduced())
  // Breathing pulse while the autonomous step is in flight. We blend
  // theme.warning onto theme.background at an alpha that oscillates
  // between PULSE_MIN_ALPHA and PULSE_MAX_ALPHA, so the highlight
  // brightens and dims rather than staying flat. The midpoint matches
  // the old static 0.22 so themes that worked before still read the
  // same on average. When animations are disabled the hook returns a
  // constant phase of 0.5 → midpoint alpha → behaves as the old static
  // tint.
  const pulsePhase = useAutonomousPulse(isLiveAutonomous, {
    animationsEnabled: () => kv.get("animations_enabled", true),
  })
  const PULSE_MIN_ALPHA = 0.14
  const PULSE_MAX_ALPHA = 0.3
  const autonomousBg = createMemo(() => {
    const alpha = PULSE_MIN_ALPHA + (PULSE_MAX_ALPHA - PULSE_MIN_ALPHA) * pulsePhase()
    return tint(theme.background, theme.warning, alpha)
  })

  return (
    <Show when={trimmed()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={3}
        marginTop={1}
        flexShrink={0}
        backgroundColor={isLiveAutonomous() ? autonomousBg() : undefined}
        border={showStripe() ? ["left"] : undefined}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={showStripe() ? theme.warning : undefined}
      >
        <Switch>
          <Match when={Flag.AX_CODE_EXPERIMENTAL_MARKDOWN}>
            <markdown
              syntaxStyle={syntax()}
              streaming={true}
              content={visibleText()}
              conceal={ctx.conceal()}
              fg={theme.markdownText}
              bg={isLiveAutonomous() ? autonomousBg() : theme.background}
            />
          </Match>
          <Match when={!Flag.AX_CODE_EXPERIMENTAL_MARKDOWN}>
            <SessionCodeRenderer
              display={codeDisplayView({ filePath: "message.md", content: visibleText() })}
              streaming={true}
              syntaxStyle={syntax()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          </Match>
        </Switch>
        <Show when={overflow()}>
          <text fg={theme.textMuted} onMouseUp={() => setExpanded((prev) => !prev)}>
            {expanded() ? "Click to collapse" : `… ${lines().length - 50} more lines · click to expand`}
          </text>
        </Show>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const sync = useSync()
  const { theme } = useTheme()

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
  }

  return (
    <Show when={!shouldHide()}>
      <ErrorBoundary
        fallback={
          <box paddingLeft={3} flexDirection="row" gap={1}>
            <text fg={theme.warning}>{"▲"}</text>
            <text fg={theme.textMuted}>failed to render {props.part.tool} output</text>
          </box>
        }
      >
        <Dynamic component={toolRendererComponent(props.part.tool)} {...toolprops} />
      </ErrorBoundary>
    </Show>
  )
}

function CoalescedTool(props: {
  group: { tool: string; parts: ToolPart[]; key: string }
  message: AssistantMessage
  expanded: boolean
  onToggle: (next: boolean) => void
}) {
  const { theme } = useTheme()
  const label = createMemo(() => coalescedToolLabel(props.group.tool, props.group.parts.length))
  // Any in-flight part means the group is still mid-stream — without
  // a spinner the collapsed row reads as "done" even when reads are
  // still landing one-by-one.
  const isRunning = createMemo(() =>
    props.group.parts.some((p) => p.state.status === "running" || p.state.status === "pending"),
  )
  return (
    <Show
      when={props.expanded}
      fallback={
        <box paddingLeft={3} flexDirection="row">
          <Chip status={isRunning() ? "running" : "done"} spinner={isRunning()} onMouseUp={() => props.onToggle(true)}>
            {label()} <span style={{ fg: theme.borderSubtle }}>▸</span>
          </Chip>
        </box>
      }
    >
      <For each={props.group.parts}>{(part) => <ToolPart last={false} part={part} message={props.message} />}</For>
      <box paddingLeft={3}>
        <text paddingLeft={3} fg={theme.borderSubtle} onMouseUp={() => props.onToggle(false)}>
          ▾ collapse
        </text>
      </box>
    </Show>
  )
}

// Two DisplayPart wrappers are interchangeable when they reference the exact
// same part objects — store proxies keep their identity unless the underlying
// part was replaced by a sync event, so this only misses when the part (or a
// coalesced run's membership) actually changed.
function sameDisplayPart(a: DisplayPart, b: DisplayPart): boolean {
  if (a.kind === "single" && b.kind === "single") return a.part === b.part
  if (a.kind === "coalesced" && b.kind === "coalesced")
    return a.key === b.key && a.parts.length === b.parts.length && a.parts.every((part, i) => part === b.parts[i])
  return false
}

// The v2 SDK client resolves `{error}` instead of rejecting; extract a
// human-readable message from whatever shape the server returned.
function sdkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error) return error
  if (typeof error === "object" && error) {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}
