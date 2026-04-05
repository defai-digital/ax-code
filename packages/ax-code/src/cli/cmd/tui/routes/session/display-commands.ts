import { batch, type Accessor, type Setter } from "solid-js"
import path from "path"
import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core"
import type { Part } from "@ax-code/sdk/v2"
import type { DialogContext } from "@tui/ui/dialog"
import { Clipboard } from "../../util/clipboard"
import { Editor } from "../../util/editor"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript, type MessageWithParts, type SessionInfo } from "../../util/transcript"
import { lastAssistantText, scrollDelta, scrollTo, transcriptItems } from "./display"
import { shareTitle, transcriptFilename } from "./display-command-helpers"
import { Filesystem } from "@/util/filesystem"

type Session = SessionInfo & {
  share?: {
    url?: string
  }
  revert?: {
    messageID?: string
  }
}

type Model = {
  providerID: string
  modelID: string
}

type Toast = {
  show: (input: { message: string; variant: "success" | "error" | "warning"; duration?: number }) => void
}

export function displayCommands(input: {
  conceal: Accessor<boolean>
  currentModel: () => Model | undefined
  dialogReplaceTimeline: (dialog: DialogContext) => void
  dialogReplaceFork: (dialog: DialogContext) => void
  dialogReplaceRename: (dialog: DialogContext) => void
  jumpToLastUser: () => void
  messages: Accessor<MessageWithParts["info"][]>
  parts: Record<string, MessageWithParts["parts"][number][] | undefined>
  renderer: CliRenderer
  routeSessionID: string
  scroll: ScrollBoxRenderable
  scrollToMessage: (direction: "next" | "prev", dialog: DialogContext) => void
  sdk: {
    client: {
      session: {
        share: (input: { sessionID: string }) => Promise<{ data?: { share?: { url: string } } }>
        summarize: (input: { sessionID: string; modelID: string; providerID: string }) => unknown
      }
    }
  }
  session: Accessor<Session | undefined>
  setConceal: (next: Setter<boolean>) => void
  setShowDetails: (next: Setter<boolean>) => void
  setShowGenericToolOutput: (next: Setter<boolean>) => void
  setShowHeader: (next: Setter<boolean>) => void
  setShowScrollbar: (next: Setter<boolean>) => void
  setShowThinking: (next: Setter<boolean>) => void
  setSidebar: (fn: () => "auto" | "hide") => void
  setSidebarOpen: (value: boolean) => void
  setTimestamps: (next: Setter<"hide" | "show">) => void
  shareEnabled: boolean
  showAssistantMetadata: Accessor<boolean>
  showDetails: Accessor<boolean>
  showGenericToolOutput: Accessor<boolean>
  showHeader: Accessor<boolean>
  showScrollbar: Accessor<boolean>
  showThinking: Accessor<boolean>
  showTimestamps: Accessor<boolean>
  sidebarVisible: Accessor<boolean>
  suggested: boolean
  toast: Toast
}) {
  return [
    {
      title: shareTitle(input.session()?.share?.url),
      value: "session.share",
      suggested: input.suggested,
      keybind: "session_share",
      category: "Session",
      enabled: input.shareEnabled,
      slash: {
        name: "share",
      },
      onSelect: async (dialog: DialogContext) => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() => input.toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
            .catch(() => input.toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }))
        const url = input.session()?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        await input.sdk.client.session
          .share({
            sessionID: input.routeSessionID,
          })
          .then((res) => {
            const url = res.data?.share?.url
            if (!url) throw new Error("Share endpoint returned no URL")
            return copy(url)
          })
          .catch((error) => {
            input.toast.show({
              message: error instanceof Error ? error.message : "Failed to share session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      slash: {
        name: "rename",
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceRename(dialog),
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      slash: {
        name: "timeline",
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceTimeline(dialog),
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      slash: {
        name: "fork",
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceFork(dialog),
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      onSelect: (dialog: DialogContext) => {
        const model = input.currentModel()
        if (!model) {
          input.toast.show({
            variant: "warning",
            message: "Connect a provider to summarize this session",
            duration: 3000,
          })
          return
        }
        input.sdk.client.session.summarize({
          sessionID: input.routeSessionID,
          modelID: model.modelID,
          providerID: model.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: input.sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        batch(() => {
          const visible = input.sidebarVisible()
          input.setSidebar(() => (visible ? "hide" : "auto"))
          input.setSidebarOpen(!visible)
        })
        dialog.clear()
      },
    },
    {
      title: input.conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as const,
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        input.setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: {
        name: "timestamps",
        aliases: ["toggle-timestamps"],
      },
      onSelect: (dialog: DialogContext) => {
        input.setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: input.showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "Session",
      slash: {
        name: "thinking",
        aliases: ["toggle-thinking"],
      },
      onSelect: (dialog: DialogContext) => {
        input.setShowThinking((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        input.setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        input.setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showHeader() ? "Hide header" : "Show header",
      value: "session.toggle.header",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        input.setShowHeader((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        input.setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("page-up", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("page-down", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      keybind: "messages_line_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("line-up", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      keybind: "messages_line_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("line-down", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("half-page-up", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("half-page-down", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollTo(scrollTo("first", input.scroll.scrollHeight))
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollTo(scrollTo("last", input.scroll.scrollHeight))
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      hidden: true,
      onSelect: () => input.jumpToLastUser(),
    },
    {
      title: "Next message",
      value: "session.message.next",
      keybind: "messages_next",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => input.scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      keybind: "messages_previous",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => input.scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        const result = lastAssistantText(input.messages(), input.parts, input.session()?.revert?.messageID)
        if ("error" in result) {
          input.toast.show({ message: result.error ?? "Failed to copy message", variant: "error" })
          dialog.clear()
          return
        }

        Clipboard.copy(result.text)
          .then(() => input.toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => input.toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: {
        name: "copy",
      },
      onSelect: async (dialog: DialogContext) => {
        try {
          const data = input.session()
          if (!data) return
          const transcript = formatTranscript(data, transcriptItems(input.messages(), input.parts), {
            thinking: input.showThinking(),
            toolDetails: input.showDetails(),
            assistantMetadata: input.showAssistantMetadata(),
          })
          await Clipboard.copy(transcript)
          input.toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch {
          input.toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      slash: {
        name: "export",
      },
      onSelect: async (dialog: DialogContext) => {
        try {
          const data = input.session()
          if (!data) return
          const options = await DialogExportOptions.show(
            dialog,
            transcriptFilename(data.id),
            input.showThinking(),
            input.showDetails(),
            input.showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(data, transcriptItems(input.messages(), input.parts), {
            thinking: options.thinking,
            toolDetails: options.toolDetails,
            assistantMetadata: options.assistantMetadata,
          })

          if (options.openWithoutSaving) {
            await Editor.open({ value: transcript, renderer: input.renderer })
          } else {
            const file = path.join(process.cwd(), options.filename.trim())
            await Filesystem.write(file, transcript)
            const result = await Editor.open({ value: transcript, renderer: input.renderer })
            if (result !== undefined) {
              await Filesystem.write(file, result)
            }
            input.toast.show({ message: `Session exported to ${options.filename.trim()}`, variant: "success" })
          }
        } catch {
          input.toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
  ]
}
