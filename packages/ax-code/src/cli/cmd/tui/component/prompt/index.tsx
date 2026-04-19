import {
  BoxRenderable,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  t,
  dim,
  fg,
} from "@tui/renderer-adapter/opentui"
import { createEffect, createMemo, type JSX, onMount, createSignal, onCleanup, on, Show, Switch, Match } from "solid-js"
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
import { useRenderer } from "@tui/renderer-adapter/opentui"
import { Editor } from "@tui/util/editor"
import { useExit } from "../../context/exit"
import { Clipboard } from "../../util/clipboard"
import type { FilePart } from "@ax-code/sdk/v2"
import { TuiEvent } from "../../event"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { Usage } from "../../routes/session/usage"
import { footerSessionStatusLabel } from "../../routes/session/footer-view-model"
import { Log } from "@/util/log"
import { isPromptExitCommand, resolvePromptSlashDispatch } from "./view-model"
import {
  createPromptEditorState,
  promptEditorSubmission,
  reducePromptEditor,
  type PromptEditorAction,
} from "../../input/prompt-editor"
import { blocksPromptInput, resolveFocusOwner } from "../../input/focus-manager"

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

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const sdk = useSDK()
  const route = useRoute()
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
  const [statusTick, setStatusTick] = createSignal(0)
  const statusLabel = createMemo(() => {
    statusTick()
    return footerSessionStatusLabel({
      status: status(),
      now: Date.now(),
    })
  })

  onMount(() => {
    const timer = setInterval(() => {
      if (status().type === "idle") return
      setStatusTick((value) => value + 1)
    }, 1000)

    onCleanup(() => {
      clearInterval(timer)
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
          dialog.replaceWithKind("provider", () => <DialogProvider />)
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
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })
  onCleanup(() => unsubPromptAppend())

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
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
    historyCursor: number
    historyDraft?: PromptInfo
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
    historyCursor: 0,
    historyDraft: undefined,
  })

  function currentPromptInfo(): PromptInfo {
    return {
      ...store.prompt,
      mode: store.mode,
    }
  }

  function restorePrompt(prompt: PromptInfo) {
    setStore("prompt", {
      input: prompt.input,
      parts: prompt.parts,
    })
    setStore("mode", prompt.mode ?? "normal")
    setStore("historyCursor", 0)
    setStore("historyDraft", undefined)
  }

  function currentPromptEditorState() {
    return createPromptEditorState({
      input: store.prompt.input,
      mode: store.mode,
      parts: store.prompt.parts,
      history: history.entries(),
      historyCursor: store.historyCursor,
      historyDraft: store.historyDraft,
      interrupt: store.interrupt,
    })
  }

  function applyPromptEditorState(next: ReturnType<typeof createPromptEditorState>, inputValue = next.input) {
    setStore("prompt", {
      input: inputValue,
      parts: next.parts,
    })
    setStore("mode", next.mode)
    setStore("interrupt", next.interrupt)
    setStore("historyCursor", next.historyCursor)
    setStore("historyDraft", next.historyDraft)
  }

  function applyPromptEditorAction(action: PromptEditorAction) {
    const next = reducePromptEditor(currentPromptEditorState(), action)
    applyPromptEditorState(next)
  }

  function clearPromptInput() {
    input.extmarks.clear()
    input.clear()
    setStore("extmarkToPartIndex", new Map())
    applyPromptEditorAction({ type: "prompt.cleared" })
  }

  function commitPromptSubmission() {
    applyPromptEditorAction({ type: "submission.committed" })
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())
    input.clear()
  }

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", Math.floor(Math.random() * PLACEHOLDERS.length))
      },
      { defer: true },
    ),
  )

  const inputOwner = createMemo(() =>
    resolveFocusOwner({
      prompt: {
        visible: props.visible !== false,
        disabled: props.disabled,
      },
      dialog: dialog.kind,
    }),
  )

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
        owners: ["prompt"],
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          clearPromptInput()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        owners: ["prompt"],
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
        owners: ["prompt"],
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
        owners: ["prompt"],
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: store.mode === "shell",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          applyPromptEditorAction({ type: "prompt.cancelled" })
          dialog.clear()
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        owners: ["prompt"],
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle" && store.mode !== "shell",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          if (!props.sessionID) return

          const nextInterrupt = store.interrupt + 1
          applyPromptEditorAction({ type: "interrupt.incremented" })

          const resetInterrupt = setTimeout(() => {
            applyPromptEditorAction({ type: "interrupt.reset" })
          }, 5000)

          if (nextInterrupt >= 2) {
            clearTimeout(resetInterrupt)
            sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            applyPromptEditorAction({ type: "interrupt.reset" })
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        owners: ["prompt"],
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
        title: "Skills",
        value: "prompt.skills",
        owners: ["prompt"],
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
                    restorePrompt({
                      input: `/${skill} `,
                      mode: "normal",
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
      return currentPromptInfo()
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      restorePrompt(prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      clearPromptInput()
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
      owners: ["prompt"],
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push(currentPromptInfo())
        clearPromptInput()
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      owners: ["prompt"],
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          restorePrompt(entry)
          restoreExtmarksFromParts(entry.parts)
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      owners: ["prompt"],
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
                  restorePrompt(entry)
                  restoreExtmarksFromParts(entry.parts)
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

  async function submit() {
    if (props.disabled) return
    if (autocomplete?.visible) return
    if (!store.prompt.input) return
    if (isPromptExitCommand(store.prompt.input)) {
      exit()
      return
    }
    syncExtmarksWithPromptParts()
    const submission = promptEditorSubmission(currentPromptEditorState())
    const inputText = submission.text
    const nonTextParts = submission.parts

    // Capture mode before it gets reset
    const currentPrompt = currentPromptInfo()
    const slashDispatch =
      store.mode === "shell"
        ? { type: "none" as const }
        : resolvePromptSlashDispatch({
            text: inputText,
            localSlashes: command.slashes().map((slash) => ({
              name: slash.display.slice(1),
              aliases: slash.aliases?.map((alias) => alias.slice(1)),
            })),
            remoteCommands: sync.data.command.map((item) => item.name),
          })

    if (slashDispatch.type === "local") {
      command.trySlash(slashDispatch.name)
      history.append(currentPrompt)
      commitPromptSubmission()
      props.onSubmit?.()
      return
    }

    const selectedModel = local.model.current()
    if (!selectedModel) {
      promptModelWarning()
      return
    }

    let sessionID = props.sessionID
    if (sessionID == null) {
      const res = await sdk.client.session.create({}).catch((error: unknown) => {
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

    const messageID = MessageID.ascending()
    const variant = local.model.variant.current()

    try {
      if (store.mode === "shell") {
        void sdk.client.session
          .shell({
            sessionID,
            agent: local.agent.current().name,
            model: {
              providerID: selectedModel.providerID,
              modelID: selectedModel.modelID,
            },
            command: inputText,
          })
          .then((res) => {
            if (res.error) reportSubmitFailure("Shell command submission", res.error)
          })
          .catch((error: unknown) => reportSubmitFailure("Shell command submission", error))
        applyPromptEditorAction({ type: "prompt.cancelled" })
      } else if (slashDispatch.type === "remote") {
        void sdk.client.session
          .command({
            sessionID,
            command: slashDispatch.name,
            arguments: slashDispatch.arguments,
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
          })
          .then((res) => {
            if (res.error) reportSubmitFailure("Command submission", res.error)
          })
          .catch((error: unknown) => reportSubmitFailure("Command submission", error))
      } else {
        const res = await sdk.client.session.promptAsync({
          sessionID,
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
        })
        if (res.error) {
          reportSubmitFailure("Prompt submission", res.error)
          return
        }
      }
    } catch (error) {
      reportSubmitFailure("Prompt submission", error)
      return
    }

    history.append(currentPrompt)
    commitPromptSubmission()
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
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

    const next = reducePromptEditor(currentPromptEditorState(), {
      type: "paste.text",
      text,
      label: virtualText,
      range: {
        start: extmarkStart,
        end: extmarkStart,
      },
    })
    applyPromptEditorState(next, input.plainText)
    setStore("extmarkToPartIndex", (map: Map<number, number>) => {
      const newMap = new Map(map)
      newMap.set(extmarkId, next.parts.length - 1)
      return newMap
    })
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
    const next = reducePromptEditor(currentPromptEditorState(), {
      type: "paste.file",
      file: part,
      label: virtualText,
      range: {
        start: extmarkStart,
        end: extmarkStart,
      },
    })
    applyPromptEditorState(next, input.plainText)
    setStore("extmarkToPartIndex", (map: Map<number, number>) => {
      const newMap = new Map(map)
      newMap.set(extmarkId, next.parts.length - 1)
      return newMap
    })
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
                syncExtmarksWithPromptParts()
                applyPromptEditorAction({
                  type: "input.changed",
                  value,
                })
                autocomplete.onInput(value)
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                if (blocksPromptInput(inputOwner())) {
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
                  clearPromptInput()
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
                  applyPromptEditorAction({ type: "mode.set", mode: "shell" })
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    applyPromptEditorAction({ type: "prompt.cancelled" })
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
                    const current = currentPromptEditorState()
                    const next = reducePromptEditor(current, {
                      type: keybind.match("history_previous", e) ? "history.previous" : "history.next",
                    })

                    if (next !== current) {
                      input.setText(next.input)
                      applyPromptEditorState(next)
                      restoreExtmarksFromParts(next.parts)
                      e.preventDefault()
                      if (next.historyCursor > current.historyCursor) input.cursorOffset = 0
                      if (next.historyCursor < current.historyCursor) input.cursorOffset = input.plainText.length
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
                if (props.disabled) {
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
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.getLayoutNode().markDirty()
                  renderer.requestRender()
                }, 0)
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.cursorColor = theme.text
                }, 0)
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
        <box flexDirection="row" justifyContent="space-between">
          <Show when={status().type !== "idle"} fallback={<text />}>
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
                  <Show when={status().type !== "retry" && statusLabel()}>
                    <text fg={theme.textMuted}>{statusLabel()}</text>
                  </Show>
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
            <box gap={2} flexDirection="row">
              <text
                fg={sync.data.smartLlm ? "magenta" : theme.text}
                onMouseUp={() => command.trigger("app.toggle.smart_llm")}
              >
                {sync.data.smartLlm ? "SmartLLM \u2714" : "SmartLLM \u24E7"}
              </text>
              {sync.data.autonomous ? (
                <box
                  backgroundColor="yellow"
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseUp={() => command.trigger("app.toggle.autonomous")}
                >
                  <text fg="red">
                    <b>Autonomous {"\u2714"}</b>
                  </text>
                </box>
              ) : (
                <text fg={theme.success} onMouseUp={() => command.trigger("app.toggle.autonomous")}>
                  Autonomous {"\u24E7"}
                </text>
              )}
              <text
                fg={sync.data.isolation.mode === "full-access" ? theme.error : theme.success}
                onMouseUp={() => command.trigger("app.toggle.sandbox")}
              >
                {sync.data.isolation.mode === "full-access" ? "Sandbox \u24E7" : "Sandbox \u2714"}
              </text>
              <Switch>
                <Match when={store.mode === "normal"}>
                  <Show when={local.model.variant.list().length > 0}>
                    <text fg={theme.text}>
                      {keybind.print("variant_cycle")} <span style={{ fg: theme.textMuted }}>variants</span>
                    </text>
                  </Show>
                  <text fg={theme.text}>
                    {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>agents</span>
                  </text>
                  <text fg={theme.text}>
                    {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
