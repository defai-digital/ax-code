import { english, type Translate } from "@tui/i18n"
import { Flag } from "@/flag/flag"
import { isNativeShiftPressed, shouldDetectNativeShiftEnter } from "@tui/util/native-shift-enter"
import { Editor } from "@tui/util/editor"
import { errorPayloadMessage } from "@tui/util/error-message"
import type { DialogContext } from "@tui/ui/dialog"
import { showBtwDialog } from "../dialog-btw"
import {
  createWorktree,
  listWorktrees,
  matchWorktree,
  moveSessionToDirectory,
  removeWorktree,
  showWorktreeListDialog,
} from "../dialog-worktree"
import type { CommandOption } from "../dialog-command"
import { DialogAlert } from "../../ui/dialog-alert"
import { loadChangelogText, resolveReleaseNotes } from "@/util/changelog"
import { endDisplayOffset, expandPromptTextParts, relocatePromptPartsAfterEditor } from "./prompt-helpers"
import type { PromptInfo } from "./history"
import type { StashEntry } from "./stash-util"
import { isTranscriptEscape } from "../../routes/session/transcript-follow"

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
  transcriptEscapeEnabled?: () => boolean
  sessionID: () => string | undefined
  statusType: () => string
  sdk: {
    url: string
    directory?: string
    fetch: typeof fetch
    client: { session: { abort: (input: { sessionID: string }) => Promise<unknown> } }
  }
  log: { warn: (message: string, extra?: Record<string, unknown>) => void }
  toast: {
    show: (input: { message: string; variant: "error" | "warning" | "info" | "success"; duration?: number }) => void
  }
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
      // Side question (ADR-213): /btw <question> answers from a bounded
      // snapshot without touching the transcript or the running turn. The
      // bare command explains the usage; the argument form is dispatched
      // through onSlashArguments.
      title: uiText("ui.btwSideQuestion"),
      value: "session.btw",
      category: uiText("common.session"),
      slash: { name: "btw", arguments: true },
      onSelect: (dialog) => {
        toast.show({ message: uiText("ui.btwUsageHint"), variant: "info", duration: 6000 })
        dialog.clear()
      },
      onSlashArguments: (args, dialog) => {
        const currentSessionID = sessionID()
        const question = args.trim()
        if (!currentSessionID) {
          toast.show({ message: uiText("ui.btwNoSession"), variant: "warning" })
          dialog.clear()
          return
        }
        if (!question) {
          toast.show({ message: uiText("ui.btwUsageHint"), variant: "info", duration: 6000 })
          dialog.clear()
          return
        }
        showBtwDialog({
          dialog,
          sdk: { url: sdk.url, directory: sdk.directory, fetch: sdk.fetch },
          sessionID: currentSessionID,
          question,
        })
      },
    },
    {
      // Session worktree (ADR-233): /worktree new [name] | list | remove
      // <name|path>. A thin wrapper over the worktree and session-move routes;
      // refused while a turn is running so the move cannot race the turn.
      title: uiText("ui.worktreeCommand"),
      value: "session.worktree",
      category: uiText("common.session"),
      slash: { name: "worktree", arguments: true },
      onSelect: (dialog) => {
        toast.show({ message: uiText("ui.worktreeUsageHint"), variant: "info", duration: 6000 })
        dialog.clear()
      },
      onSlashArguments: (args, dialog) => {
        const worktreeSdk = { url: sdk.url, directory: sdk.directory, fetch: sdk.fetch }
        const usage = () => toast.show({ message: uiText("ui.worktreeUsageHint"), variant: "info", duration: 6000 })
        const [sub, ...rest] = args.trim().split(/\s+/)
        const argument = rest.join(" ").trim()
        const run = async () => {
          if (statusType() !== "idle") {
            toast.show({ message: uiText("ui.worktreeBusy"), variant: "warning" })
            return
          }
          // The list view is the only branch that keeps the dialog open; every
          // other outcome closes it so a stale panel does not linger.
          let keepOpen = false
          try {
            if (sub === "list") {
              keepOpen = true
              showWorktreeListDialog({ dialog, sdk: worktreeSdk })
              return
            }
            if (sub === "new") {
              const currentSessionID = sessionID()
              if (!currentSessionID) {
                toast.show({ message: uiText("ui.worktreeNoSession"), variant: "warning" })
                return
              }
              const info = await createWorktree({ sdk: worktreeSdk, name: argument || undefined })
              await moveSessionToDirectory({ sdk: worktreeSdk, sessionID: currentSessionID, directory: info.directory })
              toast.show({ message: uiText("ui.worktreeCreated", { directory: info.directory }), variant: "success" })
              return
            }
            if (sub === "remove") {
              if (!argument) {
                usage()
                return
              }
              const items = await listWorktrees({ sdk: worktreeSdk })
              const match = matchWorktree(items, argument)
              if (!match) {
                toast.show({ message: uiText("ui.worktreeNotFound", { name: argument }), variant: "warning" })
                return
              }
              await removeWorktree({ sdk: worktreeSdk, directory: match.directory })
              toast.show({ message: uiText("ui.worktreeRemoved"), variant: "success" })
              return
            }
            usage()
          } catch (error) {
            log.warn("prompt worktree command failed", { error, subcommand: sub })
            toast.show({
              message: error instanceof Error ? error.message : uiText("ui.worktreeFailed"),
              variant: "error",
            })
          } finally {
            if (!keepOpen) dialog.clear()
          }
        }
        void run()
      },
    },
    {
      // Release notes (ADR-242): /release-notes [version] shows the CHANGELOG
      // section for the running version (or the given one) in a read-only
      // dialog. Uses the same pure parser as `ax-code release-notes`.
      title: uiText("ui.releaseNotes"),
      value: "session.releaseNotes",
      category: uiText("common.session"),
      slash: { name: "release-notes", arguments: true },
      onSelect: (dialog) => {
        toast.show({ message: uiText("ui.releaseNotesUsageHint"), variant: "info", duration: 6000 })
        dialog.clear()
      },
      onSlashArguments: (args, dialog) => {
        const show = () => {
          void (async () => {
            const changelog = await loadChangelogText()
            const outcome = resolveReleaseNotes({ changelog, version: args.trim() || undefined })
            const message =
              outcome.status === "ok"
                ? outcome.text
                : outcome.status === "unavailable"
                  ? uiText("ui.releaseNotesUnavailable")
                  : uiText("ui.releaseNotesNotFound", { version: outcome.requested })
            await DialogAlert.show(dialog, uiText("ui.releaseNotes"), message)
          })()
        }
        show()
      },
    },
    {
      title: uiText("ui.interruptSession"),
      value: "session.interrupt",
      keybind: "session_interrupt",
      // Global commands precede the textarea. Let plain Escape reach its
      // autocomplete/scroll handling while retaining explicit interrupt actions.
      keybindFilter: (event) => !isTranscriptEscape(event) || !input.transcriptEscapeEnabled?.(),
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
