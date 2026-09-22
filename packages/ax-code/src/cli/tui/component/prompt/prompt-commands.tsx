import { english, type Translate } from "@tui/i18n"
import { Flag } from "@/flag/flag"
import { isNativeShiftPressed, shouldDetectNativeShiftEnter } from "@tui/util/native-shift-enter"
import { Editor } from "@tui/util/editor"
import { errorPayloadMessage } from "@tui/util/error-message"
import type { DialogContext } from "@tui/ui/dialog"
import type { CommandOption } from "../dialog-command"
import { endDisplayOffset, expandPromptTextParts, relocatePromptPartsAfterEditor } from "./prompt-helpers"
import type { PromptInfo } from "./history"
import type { StashEntry } from "./stash-util"

type PromptComposer = {
  focused: boolean
  cursorOffset: number
  extmarks: { clear: () => void }
  clear: () => void
  insertText: (text: string) => void
  setText: (text: string) => void
  gotoBufferEnd: () => void
}

type PromptCommandStore = {
  prompt: PromptInfo
  mode: "normal" | "shell"
}

export type PromptCommandsInput = {
  t?: Translate
  input: () => PromptComposer
  store: PromptCommandStore
  setStore: (...args: any[]) => void
  setExpandedPastes: (value: Set<number>) => void
  submit: () => void
  pasteClipboardImage: () => Promise<unknown>
  autocompleteVisible: () => boolean
  sessionID: () => string | undefined
  statusType: () => string
  sdk: { client: { session: { abort: (input: { sessionID: string }) => Promise<unknown> } } }
  log: { warn: (message: string, extra?: Record<string, unknown>) => void }
  toast: { show: (input: { message: string; variant: "error" | "warning" | "info" | "success" }) => void }
  renderer: any
  restoreExtmarksFromParts: (parts: PromptInfo["parts"]) => void
  allPastesExpanded: () => boolean
  pasteViewsLength: () => number
  setAllPastePreviews: (expanded: boolean) => void
  dialog: DialogContext
  stash: {
    push: (entry: { input: string; parts: PromptInfo["parts"] }) => void
    pop: () => StashEntry | undefined
    list: () => readonly unknown[]
  }
}

export function promptCommands(input: PromptCommandsInput): CommandOption[] {
  const uiText = input.t ?? english

  const {
    input: composer,
    store,
    setStore,
    setExpandedPastes,
    submit,
    pasteClipboardImage,
    autocompleteVisible,
    sessionID,
    statusType,
    sdk,
    log,
    toast,
    renderer,
    restoreExtmarksFromParts,
    allPastesExpanded,
    pasteViewsLength,
    setAllPastePreviews,
    dialog,
    stash,
  } = input

  return [
    {
      title: uiText("ui.clearPrompt"),
      value: "prompt.clear",
      category: uiText("ui.prompt"),
      hidden: true,
      onSelect: (dialog) => {
        composer().extmarks.clear()
        composer().clear()
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
      title: uiText("ui.submitPrompt"),
      value: "prompt.submit",
      keybind: "input_submit",
      category: uiText("ui.prompt"),
      hidden: true,
      onSelect: (dialog) => {
        if (!composer().focused) return
        // Terminals that cannot report Shift+Enter at all (Apple Terminal,
        // Windows console): this command only ever fires for a bare CR, so
        // when the OS says Shift is physically held the user really pressed
        // Shift+Enter — insert a newline instead of submitting. Same
        // approach as kimi-code's native modifier polling.
        if (Flag.AX_CODE_TUI_NATIVE_SHIFT_ENTER && shouldDetectNativeShiftEnter() && isNativeShiftPressed()) {
          composer().insertText("\n")
          dialog.clear()
          return
        }
        submit()
        dialog.clear()
      },
    },
    {
      title: uiText("ui.paste"),
      value: "prompt.paste",
      keybind: "input_paste",
      category: uiText("ui.prompt"),
      hidden: true,
      onSelect: async () => {
        await pasteClipboardImage()
      },
    },
    {
      title: uiText("ui.exitShellMode2"),
      value: "shell.exit",
      keybind: "session_interrupt",
      category: uiText("common.session"),
      hidden: true,
      enabled: store.mode === "shell",
      onSelect: (dialog) => {
        if (autocompleteVisible()) return
        if (!composer().focused) return
        setStore("mode", "normal")
        dialog.clear()
      },
    },
    {
      title: uiText("ui.interruptSession"),
      value: "session.interrupt",
      keybind: "session_interrupt",
      category: uiText("common.session"),
      hidden: true,
      enabled: statusType() !== "idle" && store.mode !== "shell",
      onSelect: (dialog) => {
        if (autocompleteVisible()) return
        if (!composer().focused) return
        const currentSessionID = sessionID()
        if (!currentSessionID) return

        // The server pauses accepted follow-ups before aborting the active turn.
        void sdk.client.session
          .abort({
            sessionID: currentSessionID,
          })
          .then((result) => {
            const error = (result as { error?: unknown } | undefined)?.error
            if (error) {
              throw new Error(
                typeof error === "string" ? error : (errorPayloadMessage(error) ?? "Failed to interrupt session"),
              )
            }
          })
          .catch((error) => {
            log.warn("prompt session interrupt failed", {
              error,
              sessionID: currentSessionID,
            })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to interrupt session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: uiText("ui.openEditor"),
      category: uiText("common.session"),
      keybind: "editor_open",
      value: "prompt.editor",
      slash: {
        name: "editor",
        hidden: true,
      },
      onSelect: async (dialog) => {
        dialog.clear()

        const text = expandPromptTextParts(store.prompt.input, store.prompt.parts)

        const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

        const value = text
        const result = await Editor.open({ value, renderer })
        if (result.status === "missing-editor") {
          toast.show({
            message: uiText("ui.noEditorConfiguredSetVisualOrEditorToUseEditor"),
            variant: "warning",
          })
          return
        }
        if (result.status === "cancelled") return
        const content = result.content

        composer().setText(content)

        // Update positions for nonTextParts based on their location in new content
        // Filter out parts whose virtual text was deleted
        // this handles a case where the user edits the text in the editor
        // such that the virtual text moves around or is deleted
        const updatedNonTextParts = relocatePromptPartsAfterEditor(nonTextParts, content)

        setStore("prompt", {
          input: content,
          // keep only the non-text parts because the text parts were
          // already expanded inline
          parts: updatedNonTextParts,
        })
        restoreExtmarksFromParts(updatedNonTextParts)
        composer().cursorOffset = endDisplayOffset(content)
      },
    },
    {
      title: allPastesExpanded() ? uiText("prompt.collapsePastes") : uiText("prompt.expandPastes"),
      value: "prompt.paste.preview.toggle",
      category: uiText("ui.prompt"),
      enabled: pasteViewsLength() > 0,
      onSelect: (dialog) => {
        setAllPastePreviews(!allPastesExpanded())
        dialog.clear()
      },
    },
    {
      title: uiText("ui.skills"),
      value: "prompt.skills",
      category: uiText("ui.prompt"),
      slash: {
        name: "skills",
        hidden: true,
      },
      onSelect: () => {
        const marker = dialog.stack.at(-1)
        import("../dialog-skill")
          .then(({ DialogSkill }) => {
            if (dialog.stack.at(-1) !== marker) return
            dialog.replace(() => (
              <DialogSkill
                onSelect={(skill) => {
                  composer().setText(`/${skill} `)
                  setStore("prompt", {
                    input: `/${skill} `,
                    parts: [],
                  })
                  composer().gotoBufferEnd()
                }}
              />
            ))
          })
          .catch((error) => {
            log.warn("failed to load skill dialog", { error })
            toast.show({ message: uiText("ui.failedToOpenSkills"), variant: "error" })
          })
      },
    },
    {
      title: uiText("ui.stashPrompt"),
      value: "prompt.stash",
      category: uiText("ui.prompt"),
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        composer().extmarks.clear()
        composer().clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        setExpandedPastes(new Set<number>())
        dialog.clear()
      },
    },
    {
      title: uiText("ui.stashPop"),
      value: "prompt.stash.pop",
      category: uiText("ui.prompt"),
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          composer().setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          setExpandedPastes(new Set<number>())
          composer().gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: uiText("ui.stashList"),
      value: "prompt.stash.list",
      category: uiText("ui.prompt"),
      enabled: stash.list().length > 0,
      onSelect: () => {
        const marker = dialog.stack.at(-1)
        import("../dialog-stash")
          .then(({ DialogStash }) => {
            if (dialog.stack.at(-1) !== marker) return
            dialog.replace(() => (
              <DialogStash
                onSelect={(entry) => {
                  composer().setText(entry.input)
                  setStore("prompt", { input: entry.input, parts: entry.parts })
                  restoreExtmarksFromParts(entry.parts)
                  setExpandedPastes(new Set<number>())
                  composer().gotoBufferEnd()
                }}
              />
            ))
          })
          .catch((error) => {
            log.warn("failed to load stash dialog", { error })
            toast.show({ message: uiText("ui.failedToOpenStash"), variant: "error" })
          })
      },
    },
  ]
}
