import { english, type Translate } from "@tui/i18n"
import { batch, type Accessor, type Setter } from "solid-js"
import type { CliRenderer, ScrollBoxRenderable } from "ax-tui"
import type { DialogContext } from "@tui/ui/dialog"
import { Clipboard } from "../../util/clipboard"
import { Editor } from "../../util/editor"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { DialogAlert } from "../../ui/dialog-alert"
import { formatTranscript, type MessageWithParts, type SessionInfo } from "../../util/transcript"
import { lastAssistantText, scrollDelta, scrollTo, transcriptItems } from "./display"
import {
  parseCompactArgs,
  renderCompactPreview,
  resolveTranscriptExportPath,
  transcriptFilename,
  type CompactArgs,
} from "./display-command-helpers"
import { sdkErrorMessage } from "./sdk-error-message"
import { Filesystem } from "@/util/filesystem"
import { RunReportServer } from "@/cli/cmd/run-report-server"
import open from "open"

type Session = SessionInfo & {
  directory?: string
  revert?: {
    messageID?: string
  }
  // ADR-226: user-pinned messages carried on the session record.
  pins?: Array<{ messageID: string; text: string }>
}

type Model = {
  providerID: string
  modelID: string
}

type Toast = {
  show: (input: { message: string; variant: "success" | "error" | "warning"; duration?: number }) => void
}

export function displayCommands(input: {
  openWikiVisualization?: () => Promise<void>
  wikiVisualizationOpening?: Accessor<boolean>
  t?: Translate
  conceal: Accessor<boolean>
  currentModel: () => Model | undefined
  dialogReplaceActivity: (dialog: DialogContext) => void
  dialogReplaceBranch: (dialog: DialogContext) => void
  dialogReplaceCapability: (dialog: DialogContext) => void
  dialogReplaceCompare: (dialog: DialogContext) => void
  dialogReplaceDre: (dialog: DialogContext) => void
  dialogReplaceExecutionGraph: (dialog: DialogContext) => void
  dialogReplaceGoal: (dialog: DialogContext) => void
  dialogReplaceQuality: (dialog: DialogContext) => void
  dialogReplaceWorkflow: (dialog: DialogContext) => void
  dialogReplaceRollback: (dialog: DialogContext) => void
  dialogReplaceTimeline: (dialog: DialogContext) => void
  dialogReplaceDiffViewer: (dialog: DialogContext) => void
  dialogReplaceFork: (dialog: DialogContext) => void
  dialogReplaceRename: (dialog: DialogContext) => void
  children: Accessor<Array<{ id: string }>>
  jumpToLastUser: () => void
  messages: Accessor<MessageWithParts["info"][]>
  parts: Record<string, MessageWithParts["parts"][number][] | undefined>
  renderer: CliRenderer
  routeSessionID: string
  scroll: ScrollBoxRenderable
  scrollToMessage: (direction: "next" | "prev", dialog: DialogContext) => void
  sdk: {
    url: string
    client: {
      session: {
        summarize: (input: {
          sessionID: string
          modelID: string
          providerID: string
          focus?: string
        }) => Promise<{ error?: unknown }>
        // ADR-226: pins are new routes. Typed optional so this file compiles
        // before the SDK is regenerated; the call sites guard for absence.
        pin?: (input: { sessionID: string; messageID: string; text: string }) => Promise<{ error?: unknown }>
        unpin?: (input: { sessionID: string; messageID: string }) => Promise<{ error?: unknown }>
      }
    }
  }
  session: Accessor<Session | undefined>
  setConceal: (next: Setter<boolean>) => void
  setShowDetails: (next: Setter<boolean>) => void
  setShowAssistantStats: (next: Setter<boolean>) => void
  setShowGenericToolOutput: (next: Setter<boolean>) => void
  setShowHeader: (next: Setter<boolean>) => void
  setShowScrollbar: (next: Setter<boolean>) => void
  setShowThinking: (next: Setter<boolean>) => void
  setSidebar: (fn: () => "auto" | "hide") => void
  setSidebarOpen: (value: boolean) => void
  setMetadataDensity: (next: "auto" | "full" | "compact") => void
  setTimestamps: (next: Setter<"hide" | "show">) => void
  metadataDensity: Accessor<"auto" | "full" | "compact">
  showAssistantMetadata: Accessor<boolean>
  showAssistantStats: Accessor<boolean>
  showDetails: Accessor<boolean>
  showGenericToolOutput: Accessor<boolean>
  showHeader: Accessor<boolean>
  showScrollbar: Accessor<boolean>
  showThinking: Accessor<boolean>
  showTimestamps: Accessor<boolean>
  agents: Array<{ name: string; displayName?: string }>
  hasQualityReadiness: Accessor<boolean>
  workflowRuntimeEnabled: boolean
  sidebarVisible: Accessor<boolean>
  suggested: boolean
  toast: Toast
}) {
  const uiText = input.t ?? english

  const metadataDensityLabel = {
    auto: uiText("ui.auto"),
    full: uiText("ui.full"),
    compact: uiText("ui.compact"),
  } as const

  function nextMetadataDensity(current: "auto" | "full" | "compact"): "auto" | "full" | "compact" {
    if (current === "auto") return "compact"
    if (current === "compact") return "full"
    return "auto"
  }

  // ADR-215/ADR-225: manual compaction. `/compact <focus>` steers what the
  // summary preserves; `--keep N` keeps the last N messages verbatim; and
  // `--preview` shows the read-only preview instead of compacting. A bare
  // `/compact` (or omitted flags) keeps the unmodified summarize call.
  function runCompact(args: CompactArgs, dialog: DialogContext) {
    const model = input.currentModel()
    if (!model) {
      input.toast.show({
        variant: "warning",
        message: uiText("ui.connectAProviderToSummarizeThisSession"),
        duration: 3000,
      })
      dialog.clear()
      return
    }
    void Promise.resolve()
      .then(() =>
        input.sdk.client.session.summarize({
          sessionID: input.routeSessionID,
          modelID: model.modelID,
          providerID: model.providerID,
          ...(args.focus ? { focus: args.focus } : {}),
          ...(args.keep === undefined ? {} : { keep: args.keep }),
          ...(args.preview ? { preview: true } : {}),
        }),
      )
      .then((result) => {
        // The v2 SDK client resolves `{error}` instead of rejecting, so
        // a failed summarize must be checked here — the .catch below
        // never fires for HTTP errors.
        if (result?.error) {
          input.toast.show({
            message: sdkErrorMessage(result.error, "Failed to summarize session"),
            variant: "error",
          })
          return
        }
        // ADR-225: a preview returns the counts object (no compaction ran);
        // show it in a dialog. A real summarize returns `true`. The generated
        // type only knows `boolean`, so read the union through a cast — same
        // precedent as the revert call in dialog-message.tsx.
        const data = (result as { data?: unknown }).data
        if (args.preview && data && typeof data === "object") {
          void DialogAlert.show(
            dialog,
            uiText("ui.compactPreview"),
            renderCompactPreview(data as Parameters<typeof renderCompactPreview>[0]),
          )
          return
        }
        dialog.clear()
      })
      .catch((error) => {
        input.toast.show({
          message: error instanceof Error ? error.message : "Failed to summarize session",
          variant: "error",
        })
      })
  }

  // ADR-226: pins. The candidate is the last user message (or an explicit id
  // when invoked from a message action). Text is captured from its parts.
  function pinTargetText(messageID?: string): { messageID: string; text: string } | undefined {
    const infos = input.messages()
    const userMessages = infos.filter((info) => info.role === "user")
    const target = messageID ? userMessages.find((info) => info.id === messageID) : userMessages.at(-1)
    if (!target) return undefined
    const text = (input.parts[target.id] ?? [])
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim()
    if (!text) return undefined
    return { messageID: target.id, text }
  }

  function runPin(dialog: DialogContext, messageID?: string) {
    const target = pinTargetText(messageID)
    if (!target) {
      input.toast.show({ variant: "warning", message: uiText("ui.pinNoUserMessage"), duration: 3000 })
      dialog.clear()
      return
    }
    if (!input.sdk.client.session.pin) {
      input.toast.show({ message: uiText("ui.failedToPinMessage"), variant: "error" })
      dialog.clear()
      return
    }
    void input.sdk.client.session
      .pin({ sessionID: input.routeSessionID, messageID: target.messageID, text: target.text })
      .then((result) => {
        if (result?.error) {
          input.toast.show({ message: sdkErrorMessage(result.error, "Failed to pin message"), variant: "error" })
          return
        }
        input.toast.show({ message: uiText("ui.messagePinned"), variant: "success", duration: 2000 })
      })
      .catch((error) => {
        input.toast.show({
          message: error instanceof Error ? error.message : "Failed to pin message",
          variant: "error",
        })
      })
    dialog.clear()
  }

  function runUnpin(dialog: DialogContext, messageID?: string) {
    const target = pinTargetText(messageID)
    if (!target) {
      input.toast.show({ variant: "warning", message: uiText("ui.pinNoUserMessage"), duration: 3000 })
      dialog.clear()
      return
    }
    if (!input.sdk.client.session.unpin) {
      input.toast.show({ message: uiText("ui.failedToUnpinMessage"), variant: "error" })
      dialog.clear()
      return
    }
    void input.sdk.client.session
      .unpin({ sessionID: input.routeSessionID, messageID: target.messageID })
      .then((result) => {
        if (result?.error) {
          input.toast.show({ message: sdkErrorMessage(result.error, "Failed to unpin message"), variant: "error" })
          return
        }
        input.toast.show({ message: uiText("ui.messageUnpinned"), variant: "success", duration: 2000 })
      })
      .catch((error) => {
        input.toast.show({
          message: error instanceof Error ? error.message : "Failed to unpin message",
          variant: "error",
        })
      })
    dialog.clear()
  }

  function runPinList(dialog: DialogContext) {
    const pins = input.session()?.pins ?? []
    const body = pins.length === 0 ? uiText("ui.pinListEmpty") : pins.map((pin) => pin.text).join("\n\n---\n\n")
    void DialogAlert.show(dialog, uiText("ui.pinListTitle"), body)
  }

  return [
    {
      title: uiText("ui.openWikiVisualization"),
      value: "session.wiki.viz",
      category: uiText("common.session"),
      enabled: !input.wikiVisualizationOpening?.(),
      slash: { name: "wiki-viz" },
      onSelect: (dialog: DialogContext) => {
        dialog.clear()
        void input.openWikiVisualization?.()
      },
    },
    {
      title: uiText("ui.renameSession"),
      value: "session.rename",
      keybind: "session_rename",
      category: uiText("common.session"),
      slash: {
        name: "rename",
        hidden: true,
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceRename(dialog),
    },
    {
      // The top bar no longer prints the raw session id; this keeps it one
      // command away for issues, logs and `--session` flags.
      title: uiText("ui.copySessionId"),
      value: "session.copy.id",
      category: uiText("common.session"),
      onSelect: async (dialog: DialogContext) => {
        dialog.clear()
        try {
          await Clipboard.copy(input.routeSessionID)
          input.toast.show({ message: uiText("ui.sessionIdCopiedToClipboard"), variant: "success", duration: 1500 })
        } catch {
          input.toast.show({ message: uiText("ui.failedToCopySessionId"), variant: "error" })
        }
      },
    },
    {
      title: uiText("ui.viewSessionGoal"),
      value: "session.goal",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => input.dialogReplaceGoal(dialog),
    },
    {
      title: uiText("ui.viewActivityHistory"),
      value: "session.activity",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => input.dialogReplaceActivity(dialog),
    },
    {
      title: uiText("ui.viewCapabilityCatalog"),
      value: "session.capability.catalog",
      category: uiText("common.session"),
      slash: {
        name: "capabilities",
        aliases: ["capability"],
        hidden: true,
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceCapability(dialog),
    },
    {
      title: uiText("ui.viewSessionTrustDre"),
      value: "session.trust",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => input.dialogReplaceDre(dialog),
    },
    {
      title: uiText("ui.viewQualityReadiness"),
      value: "session.quality",
      category: uiText("common.session"),
      enabled: input.hasQualityReadiness(),
      onSelect: (dialog: DialogContext) => input.dialogReplaceQuality(dialog),
    },
    {
      title: uiText("ui.viewWorkflowRuns"),
      value: "session.workflow.runs",
      category: uiText("common.session"),
      enabled: input.workflowRuntimeEnabled,
      hidden: !input.workflowRuntimeEnabled,
      slash: {
        name: "workflows",
        aliases: ["workflow"],
        hidden: true,
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceWorkflow(dialog),
    },
    {
      title: uiText("ui.viewExecutionGraphDre"),
      value: "session.execution.graph",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => input.dialogReplaceExecutionGraph(dialog),
    },
    {
      title: uiText("ui.openRunReportInBrowser"),
      value: "session.report.web",
      category: uiText("common.session"),
      onSelect: async (dialog: DialogContext) => {
        await RunReportServer.page({
          base: input.sdk.url,
          sessionID: input.routeSessionID,
          directory: input.session()?.directory,
        })
          .then((url) => open(url.toString()))
          .catch(() =>
            input.toast.show({
              message: uiText("ui.failedToOpenRunReportInTheBrowser"),
              variant: "error",
            }),
          )
          .finally(() => dialog.clear())
      },
    },
    {
      title: uiText("ui.viewBranchRanking"),
      value: "session.branch",
      category: uiText("common.session"),
      enabled: input.children().length > 1,
      onSelect: (dialog: DialogContext) => input.dialogReplaceBranch(dialog),
    },
    {
      title: uiText("ui.compareBranchExecutions"),
      value: "session.compare",
      category: uiText("common.session"),
      enabled: input.children().length > 1,
      onSelect: (dialog: DialogContext) => input.dialogReplaceCompare(dialog),
    },
    {
      title: uiText("ui.viewRollbackPoints"),
      value: "session.rollback",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => input.dialogReplaceRollback(dialog),
    },
    {
      title: uiText("ui.viewSessionDiff"),
      value: "session.diff",
      keybind: "session_diff_view",
      category: uiText("common.session"),
      slash: {
        name: "diff",
        hidden: true,
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceDiffViewer(dialog),
    },
    {
      title: uiText("ui.jumpToMessage"),
      value: "session.timeline",
      keybind: "session_timeline",
      category: uiText("common.session"),
      slash: {
        name: "timeline",
        hidden: true,
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceTimeline(dialog),
    },
    {
      title: uiText("ui.forkFromMessage"),
      value: "session.fork",
      keybind: "session_fork",
      category: uiText("common.session"),
      slash: {
        name: "fork",
        hidden: true,
      },
      onSelect: (dialog: DialogContext) => input.dialogReplaceFork(dialog),
    },
    {
      title: uiText("ui.compactSession"),
      value: "session.compact",
      keybind: "session_compact",
      category: uiText("common.session"),
      slash: {
        name: "compact",
        aliases: ["summarize"],
        // `/compact [--keep N] [--preview] [focus]` (ADR-215/ADR-225): the
        // inline argument steers what the summary preserves and can request a
        // read-only preview; the bare command still uses onSelect.
        arguments: true,
      },
      onSelect: (dialog: DialogContext) => runCompact(parseCompactArgs(""), dialog),
      onSlashArguments: (args: string, dialog: DialogContext) => runCompact(parseCompactArgs(args), dialog),
    },
    {
      // ADR-226: pins survive compaction verbatim. `/pin [list]` pins the last
      // user message or lists the current pins; `/unpin` removes the last pin's
      // message. Message-action variants pass an explicit message id.
      title: uiText("ui.pinMessage"),
      value: "session.pin",
      category: uiText("common.session"),
      slash: {
        name: "pin",
        arguments: true,
      },
      onSelect: (dialog: DialogContext) => runPin(dialog),
      onSlashArguments: (args: string, dialog: DialogContext) => {
        if (args.trim() === "list") return runPinList(dialog)
        runPin(dialog)
      },
    },
    {
      title: uiText("ui.unpinMessage"),
      value: "session.unpin",
      category: uiText("common.session"),
      slash: {
        name: "unpin",
      },
      onSelect: (dialog: DialogContext) => runUnpin(dialog),
    },
    {
      title: input.sidebarVisible()
        ? uiText("action.hide", { item: uiText("display.sidebar") })
        : uiText("action.show", { item: uiText("display.sidebar") }),
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: uiText("common.session"),
      slash: {
        name: "sidebar",
        aliases: ["toggle-sidebar"],
      },
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
      title: input.conceal()
        ? uiText("action.hide", { item: uiText("display.conceal") })
        : uiText("action.show", { item: uiText("display.conceal") }),
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as const,
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: uiText("display.metadata", { mode: metadataDensityLabel[input.metadataDensity()] }),
      value: "session.toggle.metadata_density",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setMetadataDensity(nextMetadataDensity(input.metadataDensity()))
        dialog.clear()
      },
    },
    {
      title: input.showTimestamps()
        ? uiText("action.hide", { item: uiText("display.timestamps") })
        : uiText("action.show", { item: uiText("display.timestamps") }),
      value: "session.toggle.timestamps",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: input.showThinking()
        ? uiText("action.hide", { item: uiText("display.thinking") })
        : uiText("action.show", { item: uiText("display.thinking") }),
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setShowThinking((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showDetails()
        ? uiText("action.hide", { item: uiText("display.toolDetails") })
        : uiText("action.show", { item: uiText("display.toolDetails") }),
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showAssistantStats()
        ? uiText("action.hide", { item: uiText("display.assistantStats") })
        : uiText("action.show", { item: uiText("display.assistantStats") }),
      value: "session.toggle.assistant_stats",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setShowAssistantStats((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: uiText("ui.toggleSessionScrollbar"),
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showHeader()
        ? uiText("action.hide", { item: uiText("display.header") })
        : uiText("action.show", { item: uiText("display.header") }),
      value: "session.toggle.header",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setShowHeader((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: input.showGenericToolOutput()
        ? uiText("action.hide", { item: uiText("display.toolOutput") })
        : uiText("action.show", { item: uiText("display.toolOutput") }),
      value: "session.toggle.generic_tool_output",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: uiText("ui.pageUp"),
      value: "session.page.up",
      keybind: "messages_page_up",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("page-up", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.pageDown"),
      value: "session.page.down",
      keybind: "messages_page_down",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("page-down", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.lineUp"),
      value: "session.line.up",
      keybind: "messages_line_up",
      category: uiText("common.session"),
      disabled: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("line-up", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.lineDown"),
      value: "session.line.down",
      keybind: "messages_line_down",
      category: uiText("common.session"),
      disabled: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("line-down", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.halfPageUp"),
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("half-page-up", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.halfPageDown"),
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollBy(scrollDelta("half-page-down", input.scroll.height))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.firstMessage"),
      value: "session.first",
      keybind: "messages_first",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollTo(scrollTo("first", input.scroll.scrollHeight))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.lastMessage"),
      value: "session.last",
      keybind: "messages_last",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        input.scroll.scrollTo(scrollTo("last", input.scroll.scrollHeight))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.jumpToCurrentInput"),
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        input.jumpToLastUser()
        dialog.clear()
      },
    },
    {
      title: uiText("ui.nextMessage"),
      value: "session.message.next",
      keybind: "messages_next",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => input.scrollToMessage("next", dialog),
    },
    {
      title: uiText("ui.previousMessage"),
      value: "session.message.previous",
      keybind: "messages_previous",
      category: uiText("common.session"),
      hidden: true,
      onSelect: (dialog: DialogContext) => input.scrollToMessage("prev", dialog),
    },
    {
      title: uiText("ui.copyLastAssistantMessage"),
      value: "messages.copy",
      keybind: "messages_copy",
      category: uiText("common.session"),
      onSelect: (dialog: DialogContext) => {
        const result = lastAssistantText(input.messages(), input.parts, input.session()?.revert?.messageID)
        if ("error" in result) {
          input.toast.show({ message: result.error ?? "Failed to copy message", variant: "error" })
          dialog.clear()
          return
        }

        Clipboard.copy(result.text)
          .then(() =>
            input.toast.show({ message: uiText("ui.messageCopiedToClipboard"), variant: "success", duration: 1500 }),
          )
          .catch(() => input.toast.show({ message: uiText("ui.failedToCopyToClipboard"), variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: uiText("ui.copySessionTranscript"),
      value: "session.copy",
      category: uiText("common.session"),
      slash: {
        name: "copy",
        hidden: true,
      },
      onSelect: async (dialog: DialogContext) => {
        try {
          const data = input.session()
          if (!data) {
            input.toast.show({ message: uiText("ui.sessionIsNoLongerAvailable"), variant: "warning" })
            dialog.clear()
            return
          }
          const transcript = formatTranscript(data, transcriptItems(input.messages(), input.parts), {
            thinking: input.showThinking(),
            toolDetails: input.showDetails(),
            assistantMetadata: input.showAssistantMetadata(),
            agents: input.agents,
          })
          await Clipboard.copy(transcript)
          input.toast.show({
            message: uiText("ui.sessionTranscriptCopiedToClipboard"),
            variant: "success",
            duration: 1500,
          })
        } catch {
          input.toast.show({ message: uiText("ui.failedToCopySessionTranscript"), variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: uiText("ui.exportSessionTranscript"),
      value: "session.export",
      keybind: "session_export",
      category: uiText("common.session"),
      slash: {
        name: "export",
        hidden: true,
      },
      onSelect: async (dialog: DialogContext) => {
        try {
          const data = input.session()
          if (!data) {
            input.toast.show({ message: uiText("ui.sessionIsNoLongerAvailable"), variant: "warning" })
            dialog.clear()
            return
          }
          // Snapshot the transcript alongside the session record now: the
          // options dialog below awaits user input, and `input.messages`/
          // `input.parts` are live accessors tied to whatever session route
          // is current when they're read. Without pinning them here, a
          // session switch while the dialog is open would export the
          // original session's title/id with a different session's
          // messages.
          const messagesSnapshot = input.messages()
          const partsSnapshot = { ...input.parts }
          const options = await DialogExportOptions.show(
            dialog,
            transcriptFilename(data.id),
            input.showThinking(),
            input.showDetails(),
            input.showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(data, transcriptItems(messagesSnapshot, partsSnapshot), {
            thinking: options.thinking,
            toolDetails: options.toolDetails,
            assistantMetadata: options.assistantMetadata,
            agents: input.agents,
          })

          if (options.openWithoutSaving) {
            await Editor.open({ value: transcript, renderer: input.renderer })
          } else {
            const file = resolveTranscriptExportPath(options.filename)
            await Filesystem.write(file, transcript)
            const result = await Editor.open({ value: transcript, renderer: input.renderer })
            if (result.status === "saved") {
              await Filesystem.write(file, result.content)
            }
            input.toast.show({
              message: uiText("status.exported", { path: options.filename.trim() }),
              variant: "success",
            })
          }
        } catch {
          input.toast.show({ message: uiText("ui.failedToExportSession"), variant: "error" })
        }
        dialog.clear()
      },
    },
  ]
}
