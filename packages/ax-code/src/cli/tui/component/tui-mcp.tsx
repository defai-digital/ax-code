import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard, usePaste } from "ax-tui/solid"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { usePromptRef } from "@tui/context/prompt"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { useCommandDialog } from "./dialog-command"
import { createTuiMcpController } from "@/tuimcp/controller"
import { startTuiMcpEndpoint } from "@/tuimcp/endpoint"
import { tuiMcpBlocked } from "./tui-mcp-guards"
import { SessionID } from "@/session/schema"
import { Log } from "@/util/log"

/** Mounted only for explicit opt-in. No listener, token or controller by default. */
export function TuiMcp(props: { blocked: boolean; onActive: (active: boolean) => void }) {
  const sdk = useSDK()
  const sync = useSync()
  const route = useRoute()
  const prompt = usePromptRef()
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()
  const command = useCommandDialog()
  const [filename, setFilename] = createSignal<string>()
  let disposed = false
  let endpoint: Awaited<ReturnType<typeof startTuiMcpEndpoint>> | undefined
  const controller = createTuiMcpController({
    state: () => ({
      workspace: sdk.directory ?? "",
      route: route.data.type,
      sessionId: route.data.type === "session" ? SessionID.make(route.data.sessionID) : undefined,
      ready:
        sdk.sseConnected && sync.data.status === "complete" && (route.data.type === "home" || sync.data.session_loaded),
      blocked:
        props.blocked ||
        tuiMcpBlocked({
          promptMounted: !!prompt.current,
          draft: prompt.current?.current.input ?? "",
          parts: prompt.current?.current.parts.length ?? 0,
          modal: dialog.stack.length > 0,
          busy: Object.values(sync.data.session_status).some((status) => status.type !== "idle"),
          pending: [...Object.values(sync.data.permission), ...Object.values(sync.data.question)].some(
            (items) => items.length > 0,
          ),
        }),
    }),
    async validateSession(sessionId, signal) {
      const response = await sdk.client.session.get({ sessionID: sessionId }, { throwOnError: true, signal })
      if (response.data.id !== sessionId) throw new Error("Unexpected session lookup result")
    },
    navigate: (sessionId) => route.navigate({ type: "session", sessionID: sessionId }),
  })
  createEffect(() => {
    controller.observe()
  })
  useKeyboard(() => controller.humanInput())
  usePaste(() => controller.humanInput())
  // Observe all raw mouse input before child handlers can stop propagation.
  let mousePrefix = ""
  const mouseInput = (chunk: Buffer | string) => {
    const sequence = mousePrefix + chunk.toString()
    mousePrefix = sequence.slice(-3)
    if (sequence.includes("\x1b[<") || sequence.includes("\x1b[M")) controller.humanInput()
  }
  onMount(() => process.stdin.prependListener("data", mouseInput))
  onCleanup(() => process.stdin.removeListener("data", mouseInput))

  function revoke() {
    if (disposed) return
    disposed = true
    controller.dispose()
    setFilename(undefined)
    props.onActive(false)
    void endpoint?.close().catch((error) => Log.Default.warn("TUIMCP cleanup failed", { error }))
  }
  command.register(() => [
    {
      title: "Revoke TUIMCP navigation access",
      value: "tui.mcp.revoke",
      slash: { name: "tui-mcp-revoke" },
      enabled: !!filename(),
      category: "System",
      onSelect: () => {
        revoke()
        dialog.clear()
      },
    },
  ])
  onMount(() => {
    void startTuiMcpEndpoint(controller, revoke)
      .then(async (started) => {
        if (disposed) {
          await started.close()
          return
        }
        endpoint = started
        setFilename(started.filename)
        props.onActive(true)
      })
      .catch((error) => {
        controller.dispose()
        Log.Default.warn("TUIMCP startup failed", { error })
        if (!disposed) toast.show({ message: "TUIMCP unavailable; see the diagnostic log", variant: "error" })
      })
  })
  onCleanup(revoke)
  return (
    <Show when={filename()}>
      {(file) => (
        <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.backgroundPanel}>
          <text fg={theme.textMuted} flexGrow={1}>
            TUIMCP on: {file()}
          </text>
          <text fg={theme.accent} onMouseUp={revoke}>
            [Revoke]
          </text>
        </box>
      )}
    </Show>
  )
}
