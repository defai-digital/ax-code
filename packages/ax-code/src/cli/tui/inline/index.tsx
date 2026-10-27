import z from "zod"
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  on,
  ErrorBoundary,
  untrack,
  type JSX,
} from "solid-js"
import { useRenderer, useTerminalDimensions } from "ax-tui/solid"
import type { TuiInput } from "../app"
import type { TuiRenderProfile } from "../renderer"
import { ArgsProvider, useArgs } from "../context/args"
import { ExitProvider, useExit } from "../context/exit"
import { KVProvider } from "../context/kv"
import { ToastProvider } from "../ui/toast"
import { RouteProvider, useRoute } from "../context/route"
import { TuiConfigProvider } from "../context/tui-config"
import { SDKProvider, useSDK } from "../context/sdk"
import { LanguageProvider, useLanguage } from "../context/language"
import { SyncProvider, useSync } from "../context/sync"
import { ThemeProvider } from "../context/theme"
import { LocalProvider, useLocal } from "../context/local"
import { KeybindProvider } from "../context/keybind"
import { PromptStashProvider } from "../component/prompt/stash"
import { AxEngineDownloadsProvider } from "../context/ax-engine-downloads"
import { DialogProvider, useDialog } from "../ui/dialog"
import { createTuiDialogLoaders } from "../tui-dialogs"
import { useToast } from "../ui/toast"
import { CommandProvider, useCommandDialog } from "../component/dialog-command"
import { FrecencyProvider } from "../component/prompt/frecency"
import { PromptHistoryProvider } from "../component/prompt/history"
import { PromptRefProvider } from "../context/prompt"
import type { PromptRef } from "../component/prompt"
import { createCommitQueue } from "./commit-queue"
import { createTranscriptProjector } from "./transcript-projector"
import { createScrollbackStream, settledTextLength } from "./scrollback-stream"
import { createInlinePreview } from "./preview"
import { STREAM_PAINT_MAX_MS } from "../routes/session/stream-paint"
import { createInlineLifecycle, inlineFooterHeight } from "./lifecycle"
import { InlineFooter } from "./footer"
import { singleLine, type TranscriptBlock } from "./block-format"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { mergeFollowUpSnapshot } from "../component/prompt/durable-follow-up"
import { directoryRequestHeaders } from "../util/request-headers"
import { unknownErrorMessage } from "../util/error-message"

export function InlineRoot(props: { input: TuiInput; profile: TuiRenderProfile; onExit: () => Promise<void> }) {
  const renderer = useRenderer()
  const stream = createScrollbackStream(renderer)
  const queue = createCommitQueue<TranscriptBlock>(
    (block) => stream.write(block),
    (error) => Log.Default.warn("inline scrollback write failed", { error }),
    { progressBatchMs: STREAM_PAINT_MAX_MS },
  )
  const lifecycle = createInlineLifecycle(renderer, props.profile, () => queue.close())
  onCleanup(() => {
    void lifecycle.close()
  })
  let notice = 0
  return (
    <ErrorBoundary
      fallback={(error) => {
        process.exitCode = 1
        queue.enqueue({ key: "inline:error", kind: "error", text: `Inline TUI error: ${unknownErrorMessage(error)}` })
        void lifecycle.close().finally(props.onExit)
        return null
      }}
    >
      <ArgsProvider {...props.input.args}>
        <ExitProvider onExit={props.onExit} destroy={lifecycle.close}>
          <KVProvider>
            <ToastProvider>
              <RouteProvider>
                <TuiConfigProvider config={props.input.config}>
                  <SDKProvider
                    url={props.input.url}
                    directory={props.input.directory}
                    fetch={props.input.fetch}
                    headers={props.input.headers}
                    events={props.input.events}
                  >
                    <LanguageProvider>
                      <SyncProvider>
                        <ThemeProvider mode="dark">
                          <LocalProvider>
                            <KeybindProvider>
                              <PromptStashProvider>
                                <AxEngineDownloadsProvider>
                                  <InlineDialogProvider
                                    onUnavailable={(text) => {
                                      queue.enqueue({ key: `dialog:${++notice}`, kind: "notice", text })
                                    }}
                                  >
                                    <CommandProvider>
                                      <FrecencyProvider>
                                        <PromptHistoryProvider>
                                          <PromptRefProvider>
                                            <InlineSession queue={queue} lifecycle={lifecycle} />
                                          </PromptRefProvider>
                                        </PromptHistoryProvider>
                                      </FrecencyProvider>
                                    </CommandProvider>
                                  </InlineDialogProvider>
                                </AxEngineDownloadsProvider>
                              </PromptStashProvider>
                            </KeybindProvider>
                          </LocalProvider>
                        </ThemeProvider>
                      </SyncProvider>
                    </LanguageProvider>
                  </SDKProvider>
                </TuiConfigProvider>
              </RouteProvider>
            </ToastProvider>
          </KVProvider>
        </ExitProvider>
      </ArgsProvider>
    </ErrorBoundary>
  )
}

/** Unsupported dialogs leave a translated hint without mounting an overlay. */
function InlineDialogProvider(props: { onUnavailable: (text: string) => void; children: JSX.Element }) {
  const t = useLanguage().t
  return (
    <DialogProvider onUnavailable={() => props.onUnavailable(t("ui.inlineDialogNeedsFullScreen"))}>
      {props.children}
    </DialogProvider>
  )
}

function InlineSession(props: {
  queue: ReturnType<typeof createCommitQueue<TranscriptBlock>>
  lifecycle: ReturnType<typeof createInlineLifecycle>
}) {
  const dialog = useDialog()
  const sync = useSync()
  const args = useArgs()
  const route = useRoute()
  const sdk = useSDK()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const local = useLocal()
  const [queueRefresh, refreshQueue] = createSignal(0)
  for (const event of ["server.connected", "server.resync_required"] as const) {
    onCleanup(sdk.event.on(event, () => refreshQueue((value) => value + 1)))
  }
  const t = useLanguage().t
  const commands = useCommandDialog()
  const dialogs = createTuiDialogLoaders({
    dialog,
    toast: useToast(),
    variantCount: () => 0,
    currentModelName: () => local.model.current()?.modelID,
  })
  commands.register(() => [
    {
      title: t("command.switchModel"),
      value: "model.list",
      keybind: "model_list",
      slash: { name: "model" },
      onSelect: () => {
        void dialogs.showModelDialog()
      },
    },
    {
      title: t("command.switchAgent"),
      value: "agent.list",
      keybind: "agent_list",
      slash: { name: "agent" },
      onSelect: () => {
        void dialogs.showAgentDialog()
      },
    },
  ])
  const projector = createTranscriptProjector({
    sessionMarker: (id) => t("ui.inlineSessionMarker", { id: singleLine(id) }),
    revertMarker: (id) => t("ui.inlineRevertMarker", { id: singleLine(id) }),
    imagePlaceholder: (name) => t("ui.inlineImagePlaceholder", { name }),
    compactionMarker: () => t("ui.inlineCompactionMarker"),
  })
  const preview = createInlinePreview()
  const [previewReserved, reservePreview] = createSignal(false)
  const [rows, setRows] = createSignal(1)
  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const expanded = () =>
    !!(
      sync.data.permission[sessionID() ?? ""]?.length ||
      sync.data.question[sessionID() ?? ""]?.length ||
      dialog.stack.length
    )
  const footerRows = () => {
    if (dialog.stack.length || sync.data.question[sessionID() ?? ""]?.length) return 20
    const permission = sync.data.permission[sessionID() ?? ""]?.[0]
    if (permission) return permission.metadata?.hookRewritten ? 18 : 13
    // Keep one preview row available, including between paragraphs and at
    // finalize. Preview presence must not resize/reposition the prompt.
    return rows() + Number(previewReserved())
  }
  const height = createMemo(() => {
    dimensions() // Resize notifications carry footer geometry, not physical terminal height.
    return inlineFooterHeight(footerRows(), renderer.terminalHeight, expanded())
  })
  // Reconnect/attach needs the durable snapshot as well as live queue events.
  createEffect(() => {
    queueRefresh()
    const id = sessionID()
    const directory = sdk.directory
    if (!id || !sdk.sseConnected || sync.data.status === "loading") return
    const abort = new AbortController()
    const deleted = new Set<string>()
    const unsubscribe = sdk.event.on("task.queue.deleted", (event) => deleted.add(event.properties.id))
    onCleanup(unsubscribe)
    onCleanup(() => abort.abort())
    untrack(() => {
      const before = new Map(sync.data.task_queue.map((item) => [item.id, JSON.stringify(item)]))
      void sdk
        .fetch(`${sdk.url.replace(/\/$/, "")}/task-queue?sessionID=${encodeURIComponent(id)}`, {
          headers: directoryRequestHeaders({ directory }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
        })
        .then(async (response) => {
          if (!response.ok) throw new Error("Unable to refresh saved follow-ups")
          const rows = z.array(z.unknown()).parse(await response.json())
          if (abort.signal.aborted || sdk.directory !== directory) return
          sync.set("task_queue", (current) => mergeFollowUpSnapshot(current, rows, id, before, deleted))
        })
        .catch((error) => {
          if (!abort.signal.aborted) Log.Default.warn("inline follow-up refresh failed", { error })
        })
        .finally(unsubscribe)
    })
  })
  let prompt: PromptRef | undefined
  let launched = false
  createEffect(() => {
    if (launched || !sync.data.session_loaded) return
    launched = true
    if (args.agent) local.agent.set(args.agent)
    const recent = sync.data.session
      .filter((item) => !item.parentID)
      .toSorted((a, b) => b.time.updated - a.time.updated)[0]
    const id =
      args.sessionID ?? (args.continue || (!args.prompt && Flag.AX_CODE_TUI_SESSION_FIRST) ? recent?.id : undefined)
    if (id && args.fork) {
      void sdk.client.session
        .fork({ sessionID: id })
        .then((result) => {
          if (result.data) route.navigate({ type: "session", sessionID: result.data.id })
          else return exit(result.error)
        })
        .catch(exit)
    } else if (id) route.navigate({ type: "session", sessionID: id })
  })
  createEffect(
    on(sessionID, (id) => {
      if (id) void sync.session.sync(id).catch(exit)
    }),
  )
  createEffect(() => {
    props.lifecycle.resize(footerRows(), expanded())
  })
  createEffect(() => {
    const id = sessionID()
    if (!id) {
      untrack(() => preview.update("", 0, true))
      return
    }
    const revert = sync.data.session.find((item) => item.id === id)?.revert
    const blocks = projector.project({
      sessionID: id,
      messages: sync.data.message[id] ?? [],
      parts: sync.data.part,
      status: sync.data.session_status[id],
      error: sync.data.session_error[id],
      revert: revert?.messageID,
      revertPart: revert?.partID,
    })
    let tail = ""
    let length = 0
    let streaming = false
    for (const block of blocks) {
      props.queue.enqueue(block)
      if (block.progress) {
        tail = block.text.slice(settledTextLength(block.text))
        length = block.text.length
        streaming = true
        if (tail) reservePreview(true)
      }
    }
    untrack(() => preview.update(tail, length, !streaming))
  })
  let initialPrompt = false
  createEffect(() => {
    if (initialPrompt || !args.prompt || !sync.data.provider_loaded || !local.model.ready || !local.model.current())
      return
    initialPrompt = true
    prompt?.set({ input: args.prompt, parts: [] })
    prompt?.submit()
  })
  onMount(() => prompt?.focus())
  return (
    <InlineFooter
      onDecision={(id, text) => props.queue.enqueue({ key: `decision:${id}`, kind: "notice", text })}
      sessionID={sessionID()}
      preview={preview.text()}
      previewReserved={previewReserved()}
      height={height()}
      onRows={setRows}
      promptRef={(ref) => {
        prompt = ref
      }}
    />
  )
}
