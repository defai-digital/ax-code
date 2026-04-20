import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent, decodePasteBytes, t, dim, fg } from "@opentui/core"
import {
  createEffect,
  createMemo,
  type JSX,
  onMount,
  createSignal,
  onCleanup,
  on,
  Show,
  Switch,
  Match,
  For,
} from "solid-js"
import "opentui-spinner/solid"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { MessageID, PartID } from "@/session/schema"
import { createStore, produce } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { assign } from "./part"
import { usePromptStash } from "./stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Editor } from "@tui/util/editor"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@ax-code/sdk/v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { Usage } from "../../routes/session/usage"
import { Log } from "@/util/log"
import { isPromptExitCommand, promptSubmissionView } from "./view-model"
import { summarizedPasteViews } from "./paste-view-model"
import { withTimeout } from "@/util/timeout"
import { footerSessionStatusView } from "../../routes/session/footer-view-model"
import { selectedForeground } from "@tui/context/theme"
import { footerToggleLabel } from "./footer-toggle"
import { footerHintWidth, promptFooterLayout } from "./footer-layout"
import { computeSessionMainPaneWidth } from "../../routes/session/layout"

const log = Log.create({ service: "tui.prompt" })

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef) => void
  hint?: JSX.Element
  showPlaceholder?: boolean
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const PLACEHOLDERS = ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"]
const SHELL_PLACEHOLDERS = ["ls -la", "git status", "pwd"]
const SUBMIT_ACCEPT_TIMEOUT_MS = 10_000
type AsyncSessionRoute = "prompt_async" | "command_async" | "shell_async"

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const [submitPending, setSubmitPending] = createSignal(false)
  const [expandedPastes, setExpandedPastes] = createSignal<Set<number>>(new Set<number>())
  const inputBlocked = createMemo(() => props.disabled || submitPending())
  const [statusTick, setStatusTick] = createSignal(0)
  const [sidebarPreference] = kv.signal<"auto" | "hide">("sidebar", "auto")

  function footerToggleChip(input: {
    label: string
    active: boolean
    activeFg: unknown
    inactiveFg: unknown
    background?: unknown
    onMouseUp: () => void
  }) {
    const fg = input.active
      ? input.background
        ? selectedForeground(theme, input.background as any)
        : input.activeFg
      : input.inactiveFg

    return (
      <box flexShrink={0}>
        <text onMouseUp={input.onMouseUp}>
          <span
            style={{
              fg: fg as any,
              bg: input.active ? (input.background as any) : undefined,
              bold: input.active,
            }}
          >
            {footerToggleLabel(input.label, input.active)}
          </span>
        </text>
      </box>
    )
  }

  function requestInputLayoutRefresh(options: { gotoBufferEnd?: boolean } = {}) {
    scheduleMicrotaskTask(() => {
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      if (options.gotoBufferEnd) input.gotoBufferEnd()
      renderer.requestRender()
    })
  }

  function syncInputCursorColor() {
    scheduleMicrotaskTask(() => {
      if (!input || input.isDestroyed) return
      input.cursorColor = inputBlocked() ? theme.backgroundElement : theme.text
    })
  }

  const promptContentWidth = createMemo(() => {
    const sidebarVisible =
      route.data.type === "session" &&
      !sync.session.get(route.data.sessionID)?.parentID &&
      sidebarPreference() === "auto" &&
      dimensions().width > 120
    return computeSessionMainPaneWidth({
      terminalWidth: dimensions().width,
      sidebarVisible,
    })
  })

  function promptModelWarning() {
    if (!sync.data.provider_loaded) {
      toast.show({
        variant: "info",
        message: "Providers are still loading",
        duration: 2000,
      })
      return
    }
    if (sync.data.provider_failed) {
      toast.show({
        variant: "warning",
        message: "Providers failed to load",
        duration: 3000,
      })
      return
    }
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      const marker = dialog.stack.at(-1)
      import("../dialog-provider")
        .then(({ DialogProvider }) => {
          if (dialog.stack.at(-1) !== marker) return
          dialog.replace(() => <DialogProvider />)
        })
        .catch((error) => {
          log.warn("failed to load provider dialog", { error })
          toast.show({ message: "Failed to open provider dialog", variant: "error" })
        })
    }
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return "Unknown error"
  }

  function reportSubmitFailure(action: string, error: unknown) {
    const message = errorMessage(error)
    log.error(`${action} failed`, { error })
    toast.show({
      message: `${action} failed: ${message}`,
      variant: "error",
    })
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0

  const unsubPromptAppend = sdk.event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    requestInputLayoutRefresh({ gotoBufferEnd: true })
  })
  onCleanup(() => unsubPromptAppend())

  createEffect(() => {
    if (inputBlocked()) input.cursorColor = theme.backgroundElement
    if (!inputBlocked()) input.cursorColor = theme.text
  })

  onMount(() => {
    const timer = setInterval(() => {
      if (status().type === "idle") return
      setStatusTick((value) => value + 1)
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  const footerLayout = createMemo(() =>
    promptFooterLayout({
      contentWidth: promptContentWidth(),
      toggleWidth:
        footerToggleLabel("Auto-route", sync.data.smartLlm).length +
        footerToggleLabel("Autonomous", sync.data.autonomous).length +
        footerToggleLabel("Sandbox", sync.data.isolation.mode !== "full-access").length,
      mode: store.mode,
      commandsWidth: footerHintWidth(keybind.print("command_list"), "commands"),
      agentsWidth: footerHintWidth(keybind.print("agent_cycle"), "agents"),
      variantsWidth:
        local.model.variant.list().length > 0 ? footerHintWidth(keybind.print("variant_cycle"), "variants") : 0,
      shellWidth: footerHintWidth("esc", "exit shell mode"),
    }),
  )

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
        setExpandedPastes(new Set<number>())
      },
      { defer: true },
    ),
  )

  const pasteViews = createMemo(() => summarizedPasteViews(store.prompt.parts))
  const allPastesExpanded = createMemo(() => {
    const views = pasteViews()
    if (views.length === 0) return false
    const expanded = expandedPastes()
    return views.every((view) => expanded.has(view.partIndex))
  })

  createEffect(() => {
    const valid = new Set<number>(pasteViews().map((view) => view.partIndex))
    setExpandedPastes((current) => {
      const next = new Set<number>([...current].filter((partIndex) => valid.has(partIndex)))
      return next.size === current.size ? current : next
    })
  })

  function togglePastePreview(partIndex: number) {
    setExpandedPastes((current) => {
      const next = new Set<number>(current)
      if (next.has(partIndex)) next.delete(partIndex)
      else next.add(partIndex)
      return next
    })
  }

  function setAllPastePreviews(expanded: boolean) {
    setExpandedPastes(expanded ? new Set<number>(pasteViews().map((view) => view.partIndex)) : new Set<number>())
  }

  // Initialize agent/model/variant from last user message when session changes.
  // syncedAgentName tracks the agent from last message so we can detect
  // user-initiated switches (Tab/dialog) vs auto-routed or default agent.
  let syncedSessionID: string | undefined
  let syncedAgentName: string | undefined = local.agent.current().name
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    // Track the agent from the latest message for userSelectedAgent detection
    if (msg?.agent) syncedAgentName = msg.agent

    if (sessionID !== syncedSessionID) {
      if (!sessionID) return
      syncedSessionID = sessionID
      // Reset to current agent on session switch so first message
      // of a new session doesn't falsely flag as user-selected
      if (!msg) {
        syncedAgentName = local.agent.current().name
        return
      }

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
        if (msg.variant) local.model.variant.set(msg.variant)
      }
    }
  })

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          setStore("prompt", {
            input: "",
            parts: [],
          })
          setStore("extmarkToPartIndex", new Map())
          setExpandedPastes(new Set<number>())
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          if (!input.focused) return
          submit()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteImage({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Exit shell mode",
        value: "shell.exit",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: store.mode === "shell",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          setStore("mode", "normal")
          dialog.clear()
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle" && store.mode !== "shell",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: allPastesExpanded() ? "Collapse pasted previews" : "Expand pasted previews",
        value: "prompt.paste.preview.toggle",
        category: "Prompt",
        enabled: pasteViews().length > 0,
        onSelect: (dialog) => {
          setAllPastePreviews(!allPastesExpanded())
          dialog.clear()
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          const marker = dialog.stack.at(-1)
          import("../dialog-skill")
            .then(({ DialogSkill }) => {
              if (dialog.stack.at(-1) !== marker) return
              dialog.replace(() => (
                <DialogSkill
                  onSelect={(skill) => {
                    input.setText(`/${skill} `)
                    setStore("prompt", {
                      input: `/${skill} `,
                      parts: [],
                    })
                    input.gotoBufferEnd()
                  }}
                />
              ))
            })
            .catch((error) => {
              log.warn("failed to load skill dialog", { error })
              toast.show({ message: "Failed to open skills", variant: "error" })
            })
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
      setExpandedPastes(new Set<number>())
    },
    submit() {
      submit()
    },
  }

  createEffect(() => {
    if (props.visible !== false) input?.focus()
    if (props.visible === false) input?.blur()
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        setExpandedPastes(new Set<number>())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          setExpandedPastes(new Set<number>())
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const marker = dialog.stack.at(-1)
        import("../dialog-stash")
          .then(({ DialogStash }) => {
            if (dialog.stack.at(-1) !== marker) return
            dialog.replace(() => (
              <DialogStash
                onSelect={(entry) => {
                  input.setText(entry.input)
                  setStore("prompt", { input: entry.input, parts: entry.parts })
                  restoreExtmarksFromParts(entry.parts)
                  setExpandedPastes(new Set<number>())
                  input.gotoBufferEnd()
                }}
              />
            ))
          })
          .catch((error) => {
            log.warn("failed to load stash dialog", { error })
            toast.show({ message: "Failed to open stash", variant: "error" })
          })
      },
    },
  ])

  function requestHeaders() {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    }
    if (sdk.directory) {
      const encoded = /[^\x00-\x7F]/.test(sdk.directory) ? encodeURIComponent(sdk.directory) : sdk.directory
      headers["x-ax-code-directory"] = encoded
      headers["x-opencode-directory"] = encoded
    }
    return headers
  }

  async function rejectionMessage(response: Response) {
    const text = await response.text().catch(() => "")
    if (!text) return `Request failed with status ${response.status}`
    try {
      const parsed = JSON.parse(text) as {
        error?: unknown
        message?: unknown
      }
      if (typeof parsed.message === "string" && parsed.message) return parsed.message
      if (typeof parsed.error === "string" && parsed.error) return parsed.error
      if (parsed.error && typeof parsed.error === "object") {
        const error = parsed.error as {
          message?: unknown
          data?: { message?: unknown }
        }
        if (typeof error.message === "string" && error.message) return error.message
        if (typeof error.data?.message === "string" && error.data.message) return error.data.message
      }
    } catch {}
    return text
  }

  async function submitAsyncRoute(input: {
    sessionID: string
    path: AsyncSessionRoute
    body: unknown
    action: string
  }) {
    const response = await withTimeout(
      sdk.fetch(`${sdk.url}/session/${encodeURIComponent(input.sessionID)}/${input.path}`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(input.body),
      }),
      SUBMIT_ACCEPT_TIMEOUT_MS,
      `${input.action} acceptance timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
    )

    if (response.status === 202 || response.ok) return
    throw new Error(await rejectionMessage(response))
  }

  async function submit() {
    if (inputBlocked()) return
    if (autocomplete?.visible) return
    if (!store.prompt.input) return
    if (isPromptExitCommand(store.prompt.input)) {
      exit()
      return
    }
    const submission = promptSubmissionView({
      text: store.prompt.input,
      parts: store.prompt.parts,
      extmarks: input.extmarks.getAllForTypeId(promptPartTypeId),
      extmarkToPartIndex: store.extmarkToPartIndex,
    })
    const inputText = submission.text
    const nonTextParts = submission.parts

    // Capture mode before it gets reset
    const currentMode = store.mode
    const firstLine = inputText.split("\n")[0]
    const slashName = inputText.startsWith("/") ? firstLine.split(" ")[0].slice(1) : undefined
    if (currentMode === "normal" && slashName && command.trySlash(slashName)) return

    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }

    setSubmitPending(true)
    let sessionID = props.sessionID
    const messageID = MessageID.ascending()
    const variant = local.model.variant.current()
    let submitAction = "Prompt submission"

    try {
      if (sessionID == null) {
        const res = await withTimeout(
          sdk.client.session.create({}),
          SUBMIT_ACCEPT_TIMEOUT_MS,
          `Session creation timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
        ).catch((error: unknown) => {
          reportSubmitFailure("Session creation", error)
          return undefined
        })
        if (!res) return

        if (res.error) {
          log.error("session create failed", { error: res.error })
          toast.show({
            message: `Creating a session failed: ${errorMessage(res.error)}`,
            variant: "error",
          })
          return
        }

        sessionID = res.data.id
      }

      if (currentMode === "shell") {
        submitAction = "Shell command submission"
        await submitAsyncRoute({
          sessionID,
          path: "shell_async",
          action: submitAction,
          body: {
            agent: local.agent.current().name,
            model: {
              providerID: selectedModel.providerID,
              modelID: selectedModel.modelID,
            },
            command: inputText,
          },
        })
        setStore("mode", "normal")
      } else if (
        inputText.startsWith("/") &&
        iife(() => {
          const command = firstLine.split(" ")[0].slice(1)
          return sync.data.command.some((x) => x.name === command)
        })
      ) {
        // Parse command from first line, preserve multi-line content in arguments
        const firstLineEnd = inputText.indexOf("\n")
        const commandLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
        const [commandName, ...firstLineArgs] = commandLine.split(" ")
        const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
        const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

        submitAction = "Command submission"
        await submitAsyncRoute({
          sessionID,
          path: "command_async",
          action: submitAction,
          body: {
            command: commandName.slice(1),
            arguments: args,
            agent: local.agent.current().name,
            model: `${selectedModel.providerID}/${selectedModel.modelID}`,
            messageID,
            variant,
            parts: nonTextParts
              .filter((x) => x.type === "file")
              .map((x) => ({
                id: PartID.ascending(),
                ...x,
              })),
          },
        })
      } else {
        submitAction = "Prompt submission"
        await submitAsyncRoute({
          sessionID,
          path: "prompt_async",
          action: submitAction,
          body: {
            ...selectedModel,
            messageID,
            agent: local.agent.current().name,
            model: selectedModel,
            variant,
            parts: [
              {
                id: PartID.ascending(),
                type: "text",
                text: inputText,
              },
              ...nonTextParts.map(assign),
            ],
            ...(local.agent.current().name !== syncedAgentName ? ({ userSelectedAgent: true } as any) : {}),
          },
        })
      }
    } catch (error) {
      reportSubmitFailure(submitAction, error)
      return
    } finally {
      setSubmitPending(false)
    }

    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    setExpandedPastes(new Set<number>())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    input.clear()
  }
  const exit = useExit()

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteImage(file: { filename?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const count = store.prompt.parts.filter((x) => x.type === "file" && x.mime.startsWith("image/")).length
    const virtualText = `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const placeholderText = createMemo(() => {
    if (props.sessionID) return undefined
    if (store.mode === "shell") {
      const example = SHELL_PLACEHOLDERS[store.placeholder % SHELL_PLACEHOLDERS.length]
      return `Run a command... "${example}"`
    }
    return `Ask anything... "${PLACEHOLDERS[store.placeholder % PLACEHOLDERS.length]}"`
  })

  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })

  const tokenInfo = createMemo(() => {
    if (!props.sessionID) return
    const msgs = sync.data.message[props.sessionID]
    if (!msgs) return
    const last = Usage.last(msgs) as any
    if (!last?.tokens) return
    const total = Usage.total(last)
    if (total === 0) return
    const model = sync.data.provider.find((x: any) => x.id === last.providerID)?.models?.[last.modelID]
    const pct = model?.limit?.context ? Math.round((total / model.limit.context) * 100) : undefined
    const formatted = total >= 1000 ? (total / 1000).toFixed(1) + "K" : String(total)
    return pct !== undefined ? `${formatted} (${pct}%)` : formatted
  })

  const busyStatus = createMemo(() => {
    statusTick()
    const current = status()
    if (current.type !== "busy") return
    return footerSessionStatusView({
      status: current,
      now: Date.now(),
    })
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => (autocomplete = r)}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} visible={props.visible !== false}>
        <box
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: "┃",
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={placeholderText()}
              textColor={keybind.leader ? theme.textMuted : theme.text}
              focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (inputBlocked()) {
                  e.preventDefault()
                  return
                }
                // Handle clipboard paste (Ctrl+V) - check for images first on Windows
                // This is needed because Windows terminal doesn't properly send image data
                // through bracketed paste, so we need to intercept the keypress and
                // directly read from clipboard before the terminal handles it
                if (keybind.match("input_paste", e)) {
                  const content = await Clipboard.read()
                  if (content?.mime.startsWith("image/")) {
                    e.preventDefault()
                    await pasteImage({
                      filename: "clipboard",
                      mime: content.mime,
                      content: content.data,
                    })
                    return
                  }
                  // If no image, let the default paste behavior continue
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  input.clear()
                  input.extmarks.clear()
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
                  setStore("extmarkToPartIndex", new Map())
                  return
                }
                if (keybind.match("app_exit", e)) {
                  if (store.prompt.input === "") {
                    await exit()
                    // Don't preventDefault - let textarea potentially handle the event
                    e.preventDefault()
                    return
                  }
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("placeholder", Math.floor(Math.random() * SHELL_PLACEHOLDERS.length))
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input)
                      setStore("prompt", item)
                      setStore("mode", item.mode ?? "normal")
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = input.plainText.length
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = input.plainText.length
                }
              }}
              onSubmit={submit}
              onPaste={async (event: PasteEvent) => {
                if (inputBlocked()) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // trim ' from the beginning and end of the pasted content. just
                // ' and nothing else
                const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
                const isUrl = /^(https?):\/\//.test(filepath)
                if (!isUrl) {
                  try {
                    const mime = Filesystem.mimeType(filepath)
                    const filename = path.basename(filepath)
                    // Handle SVG as raw text content, not as base64 image
                    if (mime === "image/svg+xml") {
                      event.preventDefault()
                      const content = await Filesystem.readText(filepath).catch(() => {})
                      if (content) {
                        pasteText(content, `[SVG: ${filename ?? "image"}]`)
                        return
                      }
                    }
                    if (mime.startsWith("image/")) {
                      event.preventDefault()
                      const content = await Filesystem.readArrayBuffer(filepath)
                        .then((buffer) => Buffer.from(buffer).toString("base64"))
                        .catch(() => {})
                      if (content) {
                        await pasteImage({
                          filename,
                          mime,
                          content,
                        })
                        return
                      }
                    }
                  } catch {}
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
                ) {
                  event.preventDefault()
                  pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                  return
                }

                // Force layout update and render for the pasted content
                requestInputLayoutRefresh()
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                syncInputCursorColor()
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
              <text fg={highlight()}>
                {store.mode === "shell"
                  ? "Shell"
                  : local.agent.icon(local.agent.current().name) +
                    " " +
                    (local.agent.current().displayName ?? Locale.titlecase(local.agent.current().name))}{" "}
              </text>
              <Show when={store.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={keybind.leader ? theme.textMuted : theme.text}>
                    {local.model.parsed().model}
                  </text>
                  <text fg={theme.textMuted}>{local.model.parsed().provider}</text>
                  <Show when={showVariant()}>
                    <text fg={theme.textMuted}>·</text>
                    <text>
                      <span style={{ fg: theme.warning, bold: true }}>{local.model.variant.current()}</span>
                    </text>
                  </Show>
                </box>
              </Show>
            </box>
            <Show when={pasteViews().length > 0}>
              <box flexDirection="column" gap={1} paddingTop={1}>
                <For each={pasteViews()}>
                  {(view) => {
                    const expanded = createMemo(() => expandedPastes().has(view.partIndex))
                    const previewText = createMemo(() => {
                      if (expanded()) return view.text
                      const lines = [...view.previewLines]
                      if (view.hiddenLineCount > 0) {
                        lines.push(`… ${view.hiddenLineCount} more line${view.hiddenLineCount === 1 ? "" : "s"}`)
                      }
                      return lines.join("\n")
                    })

                    return (
                      <box
                        border={["left"]}
                        borderColor={theme.warning}
                        customBorderChars={EmptyBorder}
                        backgroundColor={theme.backgroundPanel}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          togglePastePreview(view.partIndex)
                        }}
                      >
                        <box paddingLeft={2} paddingRight={1} paddingTop={1} paddingBottom={1}>
                          <text fg={theme.text}>
                            <span style={{ fg: theme.warning }}>▣ </span>
                            {view.label}
                          </text>
                          <text fg={theme.textMuted}>{previewText()}</text>
                          <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
                        </box>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={highlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box
          flexDirection={footerLayout().stacked ? "column" : "row"}
          justifyContent={footerLayout().stacked ? "flex-start" : "space-between"}
          gap={footerLayout().stacked ? 1 : 0}
        >
          <Show
            when={status().type !== "idle"}
            fallback={
              <Show when={submitPending()} fallback={<text />}>
                <text fg={theme.textMuted}>Submitting...</text>
              </Show>
            }
          >
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1}>
                  <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                    <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={busyStatus()?.label}>
                    <text fg={busyStatus()?.stale ? theme.warning : theme.textMuted}>{busyStatus()?.label}</text>
                  </Show>
                  {(() => {
                    const retry = createMemo(() => {
                      const s = status()
                      if (s.type !== "retry") return
                      return s
                    })
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "gemini is way too hot right now"
                      if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                      return r.message
                    })
                    const isTruncated = createMemo(() => {
                      const r = retry()
                      if (!r) return false
                      return r.message.length > 120
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const timer = setInterval(() => {
                        const next = retry()?.next
                        if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                      }, 1000)

                      onCleanup(() => {
                        clearInterval(timer)
                      })
                    })
                    const handleMessageClick = () => {
                      const r = retry()
                      if (!r) return
                      if (isTruncated()) {
                        DialogAlert.show(dialog, "Retry Error", r.message)
                      }
                    }

                    const retryText = () => {
                      const r = retry()
                      if (!r) return ""
                      const baseMessage = message()
                      const truncatedHint = isTruncated() ? " (click to expand)" : ""
                      const duration = formatDuration(seconds())
                      const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                      return baseMessage + truncatedHint + retryInfo
                    }

                    return (
                      <Show when={retry()}>
                        <box onMouseUp={handleMessageClick}>
                          <text fg={theme.error}>{retryText()}</text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                  {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box
              gap={footerLayout().stacked ? 0 : 1}
              flexDirection={footerLayout().stacked ? "column" : "row"}
              flexShrink={0}
            >
              <box flexDirection="row" flexShrink={0}>
                {footerToggleChip({
                  label: "Auto-route",
                  active: sync.data.smartLlm,
                  activeFg: theme.primary,
                  inactiveFg: theme.textMuted,
                  onMouseUp: () => command.trigger("app.toggle.smart_llm"),
                })}
                {footerToggleChip({
                  label: "Autonomous",
                  active: sync.data.autonomous,
                  activeFg: theme.text,
                  inactiveFg: theme.textMuted,
                  background: theme.warning,
                  onMouseUp: () => command.trigger("app.toggle.autonomous"),
                })}
                {footerToggleChip({
                  label: "Sandbox",
                  active: sync.data.isolation.mode !== "full-access",
                  activeFg: theme.success,
                  inactiveFg: theme.error,
                  onMouseUp: () => command.trigger("app.toggle.sandbox"),
                })}
              </box>
              <Show
                when={
                  footerLayout().showCommands ||
                  footerLayout().showAgents ||
                  footerLayout().showVariants ||
                  footerLayout().showShellHint
                }
              >
                <box gap={2} flexDirection="row" flexShrink={0}>
                  <Switch>
                    <Match when={store.mode === "normal"}>
                      <Show when={footerLayout().showVariants}>
                        <text fg={theme.text}>
                          {keybind.print("variant_cycle")} <span style={{ fg: theme.textMuted }}>variants</span>
                        </text>
                      </Show>
                      <Show when={footerLayout().showAgents}>
                        <text fg={theme.text}>
                          {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>agents</span>
                        </text>
                      </Show>
                      <Show when={footerLayout().showCommands}>
                        <text fg={theme.text}>
                          {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                        </text>
                      </Show>
                    </Match>
                    <Match when={store.mode === "shell"}>
                      <Show when={footerLayout().showShellHint}>
                        <text fg={theme.text}>
                          esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                        </text>
                      </Show>
                    </Match>
                  </Switch>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
