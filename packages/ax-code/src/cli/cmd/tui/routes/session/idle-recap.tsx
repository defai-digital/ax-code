import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { useCommandDialog } from "@tui/component/dialog-command"
import { usePromptRef } from "@tui/context/prompt"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useTuiConfig } from "@tui/context/tui-config"
import { useToast } from "@tui/ui/toast"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { footerSessionStatusOrIdle } from "./footer-view-model"
import { createRecapController } from "./recap-controller"

/** Read-only catch-up, available manually on resumed sessions and automatically after a turn. */
export function IdleRecap(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const promptRef = usePromptRef()
  const tuiConfig = useTuiConfig()
  const command = useCommandDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [recap, setRecap] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)

  const snapshot = createMemo(() => {
    const session = sync.session.get(props.sessionID)
    const messages = (sync.data.message[props.sessionID] ?? []).filter(
      (message) =>
        !session?.revert ||
        message.id < session.revert.messageID ||
        (message.id === session.revert.messageID && !!session.revert.partID),
    )
    const last = messages.at(-1)
    return {
      sessionID: props.sessionID,
      revision: `${messages.length}:${last?.id}:${last?.role === "assistant" ? last.time.completed : ""}:${session?.revert?.messageID}:${session?.revert?.partID}`,
      status: footerSessionStatusOrIdle(sync.data.session_status?.[props.sessionID]).type,
      hasMessages: messages.some((message) => message.role === "user"),
      enabled: tuiConfig?.idle_recap?.enabled ?? true,
      delayMs: Math.max(1_000, tuiConfig?.idle_recap?.delay_ms ?? 5_000),
    }
  })

  const controller = createRecapController({
    snapshot: () => ({ ...snapshot(), input: promptRef.current?.current.input ?? "" }),
    request: ({ sessionID, scope, signal }) => sdk.client.session.recap({ sessionID, scope }, { signal }),
    schedule: (task, delayMs) => scheduleTuiTimeout(task, { name: "idle-recap", delayMs, unref: true }),
    show: (view) => {
      setRecap(view.text)
      setLoading(view.loading ?? false)
    },
    notify: (message) => toast.show({ message, variant: "info", duration: 5_000 }),
  })
  createEffect(() => {
    snapshot()
    controller.update()
  })
  // Prompt input is imperative; observe edits even while a request is in flight.
  const cancelPoll = scheduleTuiInterval(() => controller.update(), {
    name: "idle-recap-input",
    delayMs: 250,
    unref: true,
  })
  onCleanup(() => {
    cancelPoll()
    controller.dispose()
  })

  command.register(() => [
    {
      title: "Show conversation recap",
      value: "session.recap",
      category: "Session",
      slash: { name: "recap" },
      onSelect: (dialog) => {
        dialog.clear()
        return controller.manual()
      },
    },
  ])

  return (
    <Show when={recap() || (loading() ? "Generating conversation recap..." : undefined)}>
      {(text) => (
        <box
          marginTop={1}
          flexShrink={0}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.backgroundPanel}
        >
          <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={theme.backgroundPanel}>
            <text fg={theme.textMuted} wrapMode="word">
              <span style={{ fg: theme.text, bold: true }}>Conversation recap</span>
              {" · "}
              {text()}
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}
