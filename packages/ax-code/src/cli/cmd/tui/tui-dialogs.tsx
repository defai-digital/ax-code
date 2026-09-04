import type { JSX } from "solid-js"
import { Log } from "@/util/log"
import { DialogAlert } from "./ui/dialog-alert"
import type { DialogContext } from "@tui/ui/dialog"

type Toast = {
  show: (input: { message: string; variant: "error" | "info" | "success" | "warning" }) => void
}

type DialogHost = {
  stack: unknown[]
  replace: (view: () => JSX.Element) => void
}

export type TuiDialogLoaders = ReturnType<typeof createTuiDialogLoaders>

const pendingDialogLoads = new WeakMap<DialogHost, symbol>()

export async function replaceLazyDialog(input: {
  dialog: DialogHost
  toast: Toast
  load: () => Promise<(() => JSX.Element) | undefined>
  warn: string
  fail: string
}) {
  // Every host transition replaces the stack array, including empty -> open
  // -> empty. A top-item marker cannot distinguish those transitions.
  const marker = input.dialog.stack
  const request = Symbol()
  pendingDialogLoads.set(input.dialog, request)
  const current = () => pendingDialogLoads.get(input.dialog) === request && input.dialog.stack === marker
  try {
    const view = await input.load()
    if (!view || !current()) return
    input.dialog.replace(view)
  } catch (error) {
    Log.Default.warn(input.warn, { error })
    if (!current()) return
    input.toast.show({ message: input.fail, variant: "error" })
  } finally {
    if (pendingDialogLoads.get(input.dialog) === request) pendingDialogLoads.delete(input.dialog)
  }
}

export function createTuiDialogLoaders(input: {
  dialog: DialogContext
  toast: Toast
  variantCount: () => number
  currentModelName: () => string | undefined
}) {
  const host = { dialog: input.dialog, toast: input.toast }

  return {
    showProviderDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load provider dialog",
        fail: "Failed to open provider dialog",
        load: async () => {
          const { DialogProvider: ProviderDialog } = await import("@tui/component/dialog-provider")
          return () => <ProviderDialog />
        },
      }),
    showProvidersDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load providers dialog",
        fail: "Failed to open providers dialog",
        load: async () => {
          const { DialogProviders } = await import("@tui/component/dialog-providers")
          return () => <DialogProviders />
        },
      }),
    showModelDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load model dialog",
        fail: "Failed to open model dialog",
        load: async () => {
          const { DialogModel: ModelDialog } = await import("@tui/component/dialog-model")
          return () => <ModelDialog />
        },
      }),
    showEffortDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load effort dialog",
        fail: "Failed to open effort dialog",
        load: async () => {
          if (input.variantCount() === 0) {
            const model = input.currentModelName()
            await DialogAlert.show(
              input.dialog,
              "Effort",
              `${model ?? "This model"} does not expose effort levels.\n\nEffort is available on Anthropic Claude, OpenAI GPT/Codex CLI, Grok Build CLI, Google Gemini, Claude Code, and OpenAI-compatible providers. Other providers can define custom levels under provider.<id>.models.<model>.variants in ax-code.json.`,
            )
            return
          }
          const { DialogEffort: EffortDialog } = await import("@tui/component/dialog-effort")
          return () => <EffortDialog />
        },
      }),
    showSessionListDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load session list dialog",
        fail: "Failed to open session list",
        load: async () => {
          const { DialogSessionList } = await import("@tui/component/dialog-session-list")
          return () => <DialogSessionList />
        },
      }),
    showWorkspaceListDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load workspace list dialog",
        fail: "Failed to open workspace list",
        load: async () => {
          const { DialogWorkspaceList } = await import("@tui/component/dialog-workspace-list")
          return () => <DialogWorkspaceList />
        },
      }),
    showAgentDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load agent dialog",
        fail: "Failed to open agent list",
        load: async () => {
          const { DialogAgent } = await import("@tui/component/dialog-agent")
          return () => <DialogAgent />
        },
      }),
    showMcpDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load mcp dialog",
        fail: "Failed to open MCP list",
        load: async () => {
          const { DialogMcp } = await import("@tui/component/dialog-mcp")
          return () => <DialogMcp />
        },
      }),
    showStatusDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load status dialog",
        fail: "Failed to open status",
        load: async () => {
          const { DialogStatus } = await import("@tui/component/dialog-status")
          return () => <DialogStatus />
        },
      }),
    showThemeListDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load theme dialog",
        fail: "Failed to open themes",
        load: async () => {
          const { DialogThemeList } = await import("@tui/component/dialog-theme-list")
          return () => <DialogThemeList />
        },
      }),
    showHelpDialog: () =>
      replaceLazyDialog({
        ...host,
        warn: "failed to load help dialog",
        fail: "Failed to open help",
        load: async () => {
          const { DialogHelp } = await import("./ui/dialog-help")
          return () => <DialogHelp />
        },
      }),
  }
}
