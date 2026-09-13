import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useCommandDialog } from "@tui/component/dialog-command"
import { usePromptRef } from "@tui/context/prompt"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useTuiConfig } from "@tui/context/tui-config"
import { useToast } from "@tui/ui/toast"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { footerSessionStatusOrIdle, hasActiveSubagentInSessionTree } from "./footer-view-model"
import { createRecapController, type RecapSnapshot } from "./recap-controller"

/** Read-only catch-up, available manually on resumed sessions and automatically
 *  once the whole session tree (including subagent runs) has settled. */
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

  const snapshot = createMemo<RecapSnapshot>(() => {
    const session = sync.session.get(props.sessionID)
    const messages = (sync.data.message[props.sessionID] ?? []).filter(
      (message) =>
        !session?.revert ||
        message.id < session.revert.messageID ||
        (message.id === session.revert.messageID && !!session.revert.partID),
    )
    const last = messages.at(-1)
    const subtree = sync.data.session.some((item) => item.parentID === props.sessionID)
    return {
      sessionID: props.sessionID,
      revision: `${messages.length}:${last?.id}:${last?.role === "assistant" ? last.time.completed : ""}:${session?.revert?.messageID}:${session?.revert?.partID}`,
      status: footerSessionStatusOrIdle(sync.data.session_status?.[props.sessionID]).type,
      treeBusy: hasActiveSubagentInSessionTree({
        sessions: sync.data.session,
        statuses: sync.data.session_status,
        parentSessionID: props.sessionID,
      }),
      hasMessages: messages.some((message) => message.role === "user"),
      enabled: tuiConfig?.idle_recap?.enabled ?? true,
      delayMs: Math.max(1_000, tuiConfig?.idle_recap?.delay_ms ?? 5_000),
      pregenerate: tuiConfig?.idle_recap?.pregenerate ?? true,
      // PromptRef.current is a Solid signal, so this memo re-runs when Prompt
      // mounts below us; store.prompt.input then tracks typing. A plain let
      // left first-observation recap armed with input: "" forever.
      input: promptRef.current?.current.input ?? "",
      autoScope: subtree ? "conversation" : "turn",
    }
  })

  const controller = createRecapController({
    snapshot,
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
  onCleanup(() => controller.dispose())

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
        <box marginTop={1} flexShrink={0}>
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
