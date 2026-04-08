import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
  useContext,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { selectedForeground, useTheme } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
  TextAttributes,
  RGBA,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@ax-code/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { BashTool } from "@/tool/bash"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import type { QuestionTool } from "@/tool/question"
import type { SkillTool } from "@/tool/skill"
import type { RefactorPlanTool } from "@/tool/refactor_plan"
import type { RefactorApplyTool } from "@/tool/refactor_apply"
import type { ImpactAnalyzeTool } from "@/tool/impact_analyze"
import type { DedupScanTool } from "@/tool/dedup_scan"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { useDialog } from "../../ui/dialog"
import { TodoItem } from "../../component/todo-item"
import { DialogMessage } from "./dialog-message"
import { DialogActivity } from "./dialog-activity"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { Sidebar } from "./sidebar"
import { Flag } from "@/flag/flag"
import parsers from "../../../../../../parsers-config.ts"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import stripAnsi from "strip-ansi"
import { Footer } from "./footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { Global } from "@/global"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { UI } from "@/cli/ui.ts"
import { useTuiConfig } from "../../context/tui-config"
import { detail, diagnostics, filetype, normalize, workdir } from "./format"
import { childAction, firstChildID, nextChildID } from "./child"
import { lastUserMessageID, promptState, redoMessageID, undoMessageID } from "./messages"
import { messageScroll, messageTarget, nextVisibleMessage } from "./navigation"
import { RevertNotice } from "./revert-notice"
import { revertState } from "./revert"
import { displayCommands } from "./display-commands"

addDefaultParsers(parsers.parsers)

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
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
  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", true)
  const [showHeader, setShowHeader] = kv.signal("header_visible", true)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [showGenericToolOutput, setShowGenericToolOutput] = kv.signal("generic_tool_output_visibility", false)

  const wide = createMemo(() => dimensions().width > 120)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() && wide() ? 42 : 0) - 4)

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

  createEffect(() => {
    sdk.setWorkspace(session()?.directory)
  })

  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        console.error(e)
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  let lastSwitch: string | undefined = undefined
  const unsubAgentSwitch = sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return
    if (part.sessionID !== route.sessionID) return
    if (part.state.status !== "completed") return
    if (part.id === lastSwitch) return

    if (part.tool === "plan_exit") {
      local.agent.set("build")
      lastSwitch = part.id
    } else if (part.tool === "plan_enter") {
      local.agent.set("plan")
      lastSwitch = part.id
    }
  })
  onCleanup(() => unsubAgentSwitch())

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()
  const dialog = useDialog()
  const renderer = useRenderer()

  // Allow exit when in child session (prompt is hidden)
  const exit = useExit()

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    const pad = (text: string) => text.padEnd(10, " ")
    const weak = (text: string) => UI.Style.TEXT_DIM + pad(text) + UI.Style.TEXT_NORMAL
    const logo = UI.logo("  ").split(/\r?\n/)
    return exit.message.set(
      [
        ...logo,
        ``,
        `  ${weak("Session")}${UI.Style.TEXT_NORMAL_BOLD}${title}${UI.Style.TEXT_NORMAL}`,
        `  ${weak("Continue")}${UI.Style.TEXT_NORMAL_BOLD}ax-code -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,
        ``,
      ].join("\n"),
    )
  })

  useKeyboard((evt) => {
    if (!session()?.parentID) return
    if (keybind.match("app_exit", evt)) {
      exit()
    }
  })

  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = nextVisibleMessage({
      direction,
      children: scroll.getChildren(),
      messages: messages(),
      parts: sync.data.part,
      scrollTop: scroll.y,
    })
    const child = targetID ? scroll.getChildren().find((item) => item.id === targetID) : undefined
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

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

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

  const command = useCommandDialog()
  command.register(() => [
    ...displayCommands({
      conceal,
      currentModel: () => local.model.current(),
      dialogReplaceActivity: (dialog) => dialog.replace(() => <DialogActivity sessionID={route.sessionID} />),
      dialogReplaceTimeline: (dialog) =>
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = messageTarget(scroll.getChildren(), messageID)
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
              const child = messageTarget(scroll.getChildren(), messageID)
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        )),
      dialogReplaceRename: (dialog) => dialog.replace(() => <DialogSessionRename session={route.sessionID} />),
      jumpToLastUser: () => {
        const list = sync.data.message[route.sessionID] ?? []
        const id = lastUserMessageID(list, sync.data.part)
        const child = messageTarget(scroll.getChildren(), id)
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
      setTimestamps,
      shareEnabled: sync.data.config.share !== "disabled",
      showAssistantMetadata,
      showDetails,
      showGenericToolOutput,
      showHeader,
      showScrollbar,
      showThinking,
      showTimestamps,
      sidebarVisible,
      agents: sync.data.agent,
      suggested: route.type === "session",
      toast,
    }),
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
      slash: {
        name: "debug",
      },
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Debug this error using debug_analyze. Paste the error message and stack trace after this line.\n\nError: ",
          parts: [],
        })
        promptRef.current?.focus()
        dialog.clear()
      },
    },
    {
      title: "Analyze change impact (DRE)",
      value: "debug.impact",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      slash: {
        name: "blast-radius",
      },
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Use impact_analyze to show the blast radius of changing <symbol or file>. Report the risk label before making any edits.",
          parts: [],
        })
        promptRef.current?.focus()
        dialog.clear()
      },
    },
    {
      title: "Find duplicate code (DRE)",
      value: "debug.dedup",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      slash: {
        name: "dedup",
      },
      onSelect: (dialog) => {
        promptRef.current?.set({
          input: "Run dedup_scan on this project and report the top clusters ranked by extraction value.",
          parts: [],
        })
        promptRef.current?.focus()
        dialog.clear()
      },
    },
    {
      title: "Scan for hardcoded values (DRE)",
      value: "debug.hardcode",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      slash: {
        name: "hardcode",
      },
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Run hardcode_scan and list findings grouped by severity. Focus on inline_secret_shape and inline_url first.",
          parts: [],
        })
        promptRef.current?.focus()
        dialog.clear()
      },
    },
    {
      title: "Plan a refactor (DRE)",
      value: "debug.refactor",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      slash: {
        name: "refactor",
      },
      onSelect: (dialog) => {
        promptRef.current?.set({
          input:
            "Use refactor_plan to draft a plan for <describe the refactor>. Do not apply anything until I review the plan.",
          parts: [],
        })
        promptRef.current?.focus()
        dialog.clear()
      },
    },
    {
      title: "List pending refactor plans (DRE)",
      value: "debug.plans",
      category: "Debugging",
      enabled: Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      hidden: !Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE,
      slash: {
        name: "plans",
      },
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
        promptRef.current?.focus()
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      category: "Session",
      enabled: !!session()?.share?.url,
      slash: {
        name: "unshare",
      },
      onSelect: async (dialog) => {
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "Failed to unshare session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      slash: {
        name: "undo",
      },
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const messageID = undoMessageID(messages(), session()?.revert?.messageID)
        if (!messageID) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID,
          })
          .then(() => {
            toBottom()
          })
        prompt.set(promptState(sync.data.part[messageID]))
        dialog.clear()
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
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = redoMessageID(messages(), session()?.revert?.messageID)
        if (!messageID) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID,
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

  // snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

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
        diffWrapMode,
        sync,
        tui: tuiConfig,
      }}
    >
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={session()}>
            <Show when={showHeader() && (!sidebarVisible() || !wide())}>
              <Header />
            </Show>
            {(() => {
              const tasks = createMemo(() => {
                const msgs = sync.data.message[route.sessionID] ?? []
                let running = 0
                let done = 0
                for (const msg of msgs) {
                  const parts = sync.data.part[msg.id] ?? []
                  for (const part of parts) {
                    if (part.type !== "tool" || (part as any).tool !== "task") continue
                    const s = (part as any).state?.status
                    if (s === "running" || s === "pending") running++
                    else if (s === "completed") done++
                  }
                }
                return { running, done, total: running + done }
              })
              return (
                <Show when={tasks().total > 0}>
                  <box flexShrink={0} paddingLeft={1}>
                    <text fg={theme.textMuted}>
                      {tasks().total} subagent{tasks().total !== 1 ? "s" : ""}
                      {tasks().running > 0 ? (
                        <span style={{ fg: theme.primary }}> · {tasks().running} active</span>
                      ) : null}
                      {tasks().done > 0 ? <span style={{ fg: theme.success }}> · {tasks().done} done</span> : null}
                    </text>
                  </box>
                </Show>
              )
            })()}
            <scrollbox
              ref={(r) => (scroll = r)}
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
              <For each={messages()}>
                {(message, index) => (
                  <Switch>
                    <Match when={message.id === revert()?.messageID}>
                      <RevertNotice count={revert()!.reverted.length} files={revert()!.diffFiles} />
                    </Match>
                    <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
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
                      />
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
              <Sidebar sessionID={route.sessionID} />
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
                  batch(() => {
                    setSidebar(() => "hide")
                    setSidebarOpen(false)
                  })
                }}
              >
                <Sidebar sessionID={route.sessionID} overlay />
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
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

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
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
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
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })

  const keybind = useKeybind()

  const hasParts = createMemo(() => props.parts.length > 0)
  const isThinking = createMemo(() => !hasParts() && !final() && props.last)

  return (
    <>
      <Show when={isThinking()}>
        <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>⋯ Thinking</text>
        </box>
      </Show>
      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
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
          <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
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
                ▣{" "}
              </span>{" "}
              <span style={{ fg: theme.text }}>
                {sync.data.agent.find((a) => a.name === props.message.agent)?.displayName ??
                  Locale.titlecase(props.message.agent)}
              </span>
              <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
              <Show when={duration()}>
                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
              </Show>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <span style={{ fg: theme.textMuted }}> · interrupted</span>
              </Show>
            </text>
          </box>
        </Match>
      </Switch>
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
    // Filter out redacted reasoning chunks from OpenRouter
    // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
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
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <Switch>
          <Match when={Flag.AX_CODE_EXPERIMENTAL_MARKDOWN}>
            <markdown
              syntaxStyle={syntax()}
              streaming={true}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.markdownText}
              bg={theme.background}
            />
          </Match>
          <Match when={!Flag.AX_CODE_EXPERIMENTAL_MARKDOWN}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          </Match>
        </Switch>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = use()
  const sync = useSync()

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
      <Switch>
        <Match when={props.part.tool === "bash"}>
          <Bash {...toolprops} />
        </Match>
        <Match when={props.part.tool === "glob"}>
          <Glob {...toolprops} />
        </Match>
        <Match when={props.part.tool === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={props.part.tool === "grep"}>
          <Grep {...toolprops} />
        </Match>
        <Match when={props.part.tool === "list"}>
          <List {...toolprops} />
        </Match>
        <Match when={props.part.tool === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "codesearch"}>
          <CodeSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={props.part.tool === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={props.part.tool === "task"}>
          <Task {...toolprops} />
        </Match>
        <Match when={props.part.tool === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "todowrite"}>
          <TodoWrite {...toolprops} />
        </Match>
        <Match when={props.part.tool === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={props.part.tool === "skill"}>
          <Skill {...toolprops} />
        </Match>
        {/* Debugging & Refactoring Engine custom renderers (Tier 2).
            Each falls back to GenericTool if the tool is registered
            but not yet emitting metadata (e.g., mid-execution). */}
        <Match when={props.part.tool === "refactor_plan"}>
          <RefactorPlan {...toolprops} />
        </Match>
        <Match when={props.part.tool === "refactor_apply"}>
          <RefactorApply {...toolprops} />
        </Match>
        <Match when={props.part.tool === "impact_analyze"}>
          <ImpactAnalyze {...toolprops} />
        </Match>
        <Match when={props.part.tool === "dedup_scan"}>
          <DedupScan {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  part: ToolPart
}
function GenericTool(props: ToolProps<any>) {
  const { theme } = useTheme()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const maxLines = 3
  const overflow = createMemo(() => lines().length > maxLines)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, maxLines), "…"].join("\n")
  })

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {detail(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${detail(props.input)}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: any
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const fg = createMemo(() => {
    if (permission()) return theme.warning
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("QuestionRejectedError") ||
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={fg()} children={props.children} />
        </Match>
        <Match when={true}>
          <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
            <Show fallback={<>~ {props.pending}</>} when={props.complete}>
              <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
            </Show>
          </text>
        </Match>
      </Switch>
      <Show when={error() && !denied()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Bash(props: ToolProps<typeof BashTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })

  const workdirDisplay = createMemo(() => {
    return workdir(sync.data.path.directory, Global.Path.home, props.input.workdir)
  })

  const title = createMemo(() => {
    const desc = props.input.description ?? "Shell"
    const wd = workdirDisplay()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })

  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={isRunning()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + normalize(props.input.filePath!)} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalize(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalize(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={props.input.filePath}
        spinner={isRunning()}
        part={props.part}
      >
        Read {normalize(props.input.filePath!)} {detail(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalize(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalize(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalize(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
      WebFetch {(props.input as any).url}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
      Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const { navigate } = useRoute()
  const local = useLocal()
  const sync = useSync()

  createEffect(
    on(
      () => props.metadata.sessionId,
      (id) => {
        if (id && !sync.data.message[id]?.length) sync.session.sync(id)
      },
    ),
  )

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() => tools().findLast((x) => (x.state as any).title))

  const isRunning = createMemo(() => props.part.state.status === "running")

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    let content = [`Task ${props.input.description}`]

    if (isRunning() && tools().length > 0) {
      // content[0] += ` · ${tools().length} toolcalls`
      if (current()) content.push(`↳ ${Locale.titlecase(current()!.tool)} ${(current()!.state as any).title}`)
      else content.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      content.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }

    return content.join("\n")
  })

  return (
    <InlineTool
      icon="│"
      spinner={isRunning()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
      }}
    >
      {content()}
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalize(props.input.filePath!)} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalize(props.input.filePath!)} {detail({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const files = createMemo(() => props.metadata.files ?? [])

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + normalize(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={title(file)} part={props.part}>
              <Show
                when={file.type !== "delete"}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                  </text>
                }
              >
                <Diff diff={file.diff} filePath={file.filePath} />
                <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)

  function format(answer?: string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>
      Skill "{props.input.name}"
    </InlineTool>
  )
}

// ─── Debugging & Refactoring Engine custom renderers (Tier 2) ──────
//
// Each renderer mirrors the existing custom tool pattern:
//   - Pending state: InlineTool with a spinner / icon + short label
//   - Complete state: BlockTool with structured content
// Output routes through the main tool Match in ToolPart.

function riskColor(theme: ReturnType<typeof useTheme>["theme"], label: string | undefined) {
  if (label === "high") return theme.error
  if (label === "medium") return theme.warning
  if (label === "low") return theme.success
  return theme.textMuted
}

function RefactorPlan(props: ToolProps<typeof RefactorPlanTool>) {
  const { theme } = useTheme()
  const plan = createMemo(() => props.metadata.plan)
  const kind = createMemo(() => plan()?.kind ?? "plan")
  const risk = createMemo(() => plan()?.risk)
  const edits = createMemo(() => plan()?.edits ?? [])
  const affectedFiles = createMemo(() => plan()?.affectedFiles ?? [])
  const summary = createMemo(() => plan()?.summary ?? "")

  return (
    <Switch>
      <Match when={plan()}>
        <BlockTool
          title={`# Refactor plan · ${kind()} · ${affectedFiles().length} file${affectedFiles().length === 1 ? "" : "s"}`}
          part={props.part}
        >
          <box flexDirection="column" gap={1}>
            {/* Risk + plan id row — the two facts a reviewer needs at a glance */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Risk</text>
              <text fg={riskColor(theme, risk())}>{risk() ?? "unknown"}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>Plan</text>
              <text fg={theme.text}>{plan()?.planId ?? ""}</text>
            </box>

            {/* Markdown summary — plain text render since not every
                terminal has the experimental markdown element enabled. */}
            <Show when={summary()}>
              <box>
                <For each={summary().split("\n")}>{(line) => <text fg={theme.text}>{line}</text>}</For>
              </box>
            </Show>

            {/* Edits list — each edit row is a {op} {target} pair. The
                whole list is shown inline because a reviewer needs to
                see every edit before approving the apply step. */}
            <Show when={edits().length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Edits ({edits().length})</text>
                <For each={edits()}>
                  {(edit) => (
                    <box flexDirection="row" gap={1} paddingLeft={1}>
                      <text fg={theme.success}>·</text>
                      <text fg={theme.text}>{edit.op}</text>
                      <text fg={theme.textMuted}>{edit.detail}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>

            {/* Affected files — capped at 15 for visual calm; the full
                list lives in metadata for callers that need it. */}
            <Show when={affectedFiles().length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Affected files ({affectedFiles().length})</text>
                <For each={affectedFiles().slice(0, 15)}>
                  {(file) => <text fg={theme.text}>{"  " + normalize(file)}</text>}
                </For>
                <Show when={affectedFiles().length > 15}>
                  <text fg={theme.textMuted}>{`  … and ${affectedFiles().length - 15} more`}</text>
                </Show>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="♺" pending="Planning refactor..." complete={false} part={props.part}>
          Planning refactor
        </InlineTool>
      </Match>
    </Switch>
  )
}

function RefactorApply(props: ToolProps<typeof RefactorApplyTool>) {
  const { theme } = useTheme()
  const result = createMemo(() => props.metadata.result)
  const applied = createMemo(() => props.metadata.applied === true)
  const abortReason = createMemo(() => props.metadata.abortReason ?? null)
  const filesChanged = createMemo(() => props.metadata.filesChanged ?? [])
  const checks = createMemo(() => result()?.checks)

  function CheckRow(p: { label: string; ok: boolean | undefined; errorCount: number }) {
    const glyph = p.ok === true ? "✓" : p.ok === false ? "✗" : "—"
    const color = p.ok === true ? theme.success : p.ok === false ? theme.error : theme.textMuted
    return (
      <box flexDirection="row" gap={1}>
        <text fg={color}>{glyph}</text>
        <text fg={theme.text}>{p.label}</text>
        <Show when={p.errorCount > 0}>
          <text fg={theme.error}>
            ({p.errorCount} error{p.errorCount === 1 ? "" : "s"})
          </text>
        </Show>
      </box>
    )
  }

  return (
    <Switch>
      <Match when={result()}>
        <BlockTool
          title={
            applied()
              ? `# Refactor applied · ${filesChanged().length} file${filesChanged().length === 1 ? "" : "s"}`
              : `# Refactor aborted · ${abortReason() ?? "unknown"}`
          }
          part={props.part}
        >
          <box flexDirection="column" gap={1}>
            {/* Applied flag + plan id row */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Applied</text>
              <text fg={applied() ? theme.success : theme.error}>{applied() ? "yes" : "no"}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>Plan</text>
              <text fg={theme.text}>{(props.metadata.planId as string) ?? ""}</text>
            </box>

            <Show when={abortReason()}>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>Reason</text>
                <text fg={theme.error}>{abortReason() ?? ""}</text>
              </box>
            </Show>

            {/* Check matrix — the whole point of the tool. Three rows,
                one per check, with status + error count. */}
            <box flexDirection="column">
              <text fg={theme.textMuted}>Checks</text>
              <box paddingLeft={1}>
                <CheckRow
                  label="typecheck"
                  ok={checks()?.typecheck.ok}
                  errorCount={checks()?.typecheck.errors.length ?? 0}
                />
                <CheckRow label="lint" ok={checks()?.lint.ok} errorCount={checks()?.lint.errors.length ?? 0} />
                <box flexDirection="row" gap={1}>
                  <text
                    fg={
                      checks()?.tests.ok === true
                        ? theme.success
                        : checks()?.tests.ok === false
                          ? theme.error
                          : theme.textMuted
                    }
                  >
                    {checks()?.tests.ok === true ? "✓" : checks()?.tests.ok === false ? "✗" : "—"}
                  </text>
                  <text fg={theme.text}>tests</text>
                  <text fg={theme.textMuted}>
                    ({checks()?.tests.selection ?? "skipped"}, ran {checks()?.tests.ran ?? 0}, failed{" "}
                    {checks()?.tests.failed ?? 0})
                  </text>
                </box>
              </box>
            </box>

            {/* Files changed (only when applied) */}
            <Show when={applied() && filesChanged().length > 0}>
              <box flexDirection="column">
                <text fg={theme.textMuted}>Files changed</text>
                <For each={filesChanged()}>{(file) => <text fg={theme.text}>{"  " + normalize(file)}</text>}</For>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="♺" pending="Applying refactor..." complete={false} spinner={true} part={props.part}>
          Applying refactor
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ImpactAnalyze(props: ToolProps<typeof ImpactAnalyzeTool>) {
  const { theme } = useTheme()
  const report = createMemo(() => props.metadata.report)
  const risk = createMemo(() => report()?.riskLabel)
  const truncated = createMemo(() => report()?.truncated === true)
  const affected = createMemo(() => report()?.affectedSymbols ?? [])
  const affectedFiles = createMemo(() => report()?.affectedFiles ?? [])
  const apiBoundariesHit = createMemo(() => report()?.apiBoundariesHit ?? 0)

  // Group affected symbols by distance for the indented display.
  const grouped = createMemo(() => {
    type Entry = ReturnType<typeof affected>[number]
    const map = new Map<number, Entry[]>()
    for (const entry of affected()) {
      const list = map.get(entry.distance) ?? []
      list.push(entry)
      map.set(entry.distance, list)
    }
    return [...map.entries()].sort(([a], [b]) => a - b)
  })

  const [expanded, setExpanded] = createSignal(false)
  const MAX_INLINE = 15

  return (
    <Switch>
      <Match when={report()}>
        <BlockTool
          title={`# Impact · ${risk() ?? "unknown"} risk · ${affected().length} symbols, ${affectedFiles().length} files`}
          part={props.part}
          onClick={affected().length > MAX_INLINE ? () => setExpanded((p) => !p) : undefined}
        >
          <box flexDirection="column" gap={1}>
            {/* Risk + boundaries + truncated row */}
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Risk</text>
              <text fg={riskColor(theme, risk())}>{risk() ?? "unknown"}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>API boundaries hit</text>
              <text fg={theme.text}>{apiBoundariesHit()}</text>
              <Show when={truncated()}>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.warning}>truncated (budget exhausted)</text>
              </Show>
            </box>

            {/* Grouped list by distance — d=1 at the top, deeper
                dependents below. Indent signals "further from seed". */}
            <Show when={affected().length > 0}>
              <box flexDirection="column">
                <For each={grouped()}>
                  {([distance, entries]) => (
                    <box flexDirection="column">
                      <text fg={theme.textMuted}>
                        distance {distance} ({entries.length})
                      </text>
                      <For each={expanded() ? entries : entries.slice(0, MAX_INLINE)}>
                        {(entry) => (
                          <text fg={theme.text}>
                            {"  ".repeat(distance)}
                            {entry.symbol.qualifiedName}{" "}
                            <span style={{ fg: theme.textMuted }}>
                              ({normalize(entry.symbol.file)}:{entry.symbol.range.start.line + 1})
                            </span>
                          </text>
                        )}
                      </For>
                    </box>
                  )}
                </For>
                <Show when={!expanded() && affected().length > MAX_INLINE}>
                  <text fg={theme.textMuted}>{`… and ${affected().length - MAX_INLINE} more (click to expand)`}</text>
                </Show>
              </box>
            </Show>
            <Show when={affected().length === 0}>
              <text fg={theme.textMuted}>No dependents found within the traversal budget.</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⟁" pending="Analyzing impact..." complete={false} part={props.part}>
          Analyzing impact
        </InlineTool>
      </Match>
    </Switch>
  )
}

function DedupScan(props: ToolProps<typeof DedupScanTool>) {
  const { theme } = useTheme()
  const report = createMemo(() => props.metadata.report)
  const clusters = createMemo(() => report()?.clusters ?? [])
  const totalLines = createMemo(() => report()?.totalDuplicateLines ?? 0)
  const truncated = createMemo(() => report()?.truncated === true)

  // Cap inline cluster display so a pathological repo doesn't flood
  // the timeline. Remaining clusters are still in metadata.
  const MAX_CLUSTERS = 10
  const MAX_MEMBERS_PER_CLUSTER = 8

  function tierColor(tier: string) {
    if (tier === "exact") return theme.error
    if (tier === "structural") return theme.warning
    return theme.success
  }

  return (
    <Switch>
      <Match when={report()}>
        <BlockTool
          title={`# Dedup · ${clusters().length} cluster${clusters().length === 1 ? "" : "s"} · ${totalLines()} shared lines`}
          part={props.part}
        >
          <box flexDirection="column" gap={1}>
            <Show when={truncated()}>
              <text fg={theme.warning}>Candidate pool was truncated — results are partial.</text>
            </Show>
            <Show when={clusters().length === 0}>
              <text fg={theme.textMuted}>No duplicate clusters found.</text>
            </Show>
            <For each={clusters().slice(0, MAX_CLUSTERS)}>
              {(cluster) => (
                <box flexDirection="column">
                  {/* Cluster header: tier + similarity + member count */}
                  <box flexDirection="row" gap={2}>
                    <text fg={tierColor(cluster.tier)}>[{cluster.tier}]</text>
                    <text fg={theme.text}>similarity {cluster.similarityScore.toFixed(2)}</text>
                    <text fg={theme.textMuted}>·</text>
                    <text fg={theme.text}>
                      {cluster.members.length} copies, {cluster.sharedLines} shared lines
                    </text>
                  </box>
                  {/* Member list — each row is a file:line target */}
                  <For each={cluster.members.slice(0, MAX_MEMBERS_PER_CLUSTER)}>
                    {(m) => (
                      <text fg={theme.text}>
                        {"  " + m.qualifiedName}{" "}
                        <span style={{ fg: theme.textMuted }}>
                          ({normalize(m.file)}:{m.range.start.line + 1})
                        </span>
                      </text>
                    )}
                  </For>
                  <Show when={cluster.members.length > MAX_MEMBERS_PER_CLUSTER}>
                    <text fg={theme.textMuted}>
                      {`  … and ${cluster.members.length - MAX_MEMBERS_PER_CLUSTER} more`}
                    </text>
                  </Show>
                  <Show when={cluster.suggestedExtractionTarget}>
                    <text fg={theme.textMuted}>
                      {"  → suggest: extract to " + (cluster.suggestedExtractionTarget || "(workspace root)")}
                    </text>
                  </Show>
                </box>
              )}
            </For>
            <Show when={clusters().length > MAX_CLUSTERS}>
              <text fg={theme.textMuted}>{`… and ${clusters().length - MAX_CLUSTERS} more cluster(s)`}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⌘" pending="Scanning for duplicates..." complete={false} part={props.part}>
          Scanning for duplicates
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Diagnostics(props: { diagnostics?: Record<string, Record<string, any>[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => diagnostics(props.diagnostics, props.filePath))

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}
