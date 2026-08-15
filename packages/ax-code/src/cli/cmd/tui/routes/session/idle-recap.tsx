import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { usePromptRef } from "@tui/context/prompt"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useTuiConfig } from "@tui/context/tui-config"
import { scheduleTuiInterval, scheduleTuiTimeout } from "@tui/util/timer"
import { footerSessionStatusOrIdle } from "./footer-view-model"

const DISMISS_POLL_MS = 250
const DEFAULT_DELAY_MS = 5_000
const MIN_DELAY_MS = 1_000

/**
 * Idle recap: after an assistant turn completes and the user stays idle for
 * the configured delay, ask the server for a short recap of the turn and show
 * it as a banner above the prompt. Best-effort only — it never blocks input,
 * never mutates the transcript, and silently no-ops on any failure. The
 * banner auto-dismisses as soon as the user starts typing, a new turn starts,
 * or the route changes.
 */
export function IdleRecap(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const promptRef = usePromptRef()
  const tuiConfig = useTuiConfig()
  const { theme } = useTheme()

  const config = createMemo(() => {
    const raw = tuiConfig?.idle_recap
    return {
      enabled: raw?.enabled ?? true,
      delayMs: Math.max(MIN_DELAY_MS, raw?.delay_ms ?? DEFAULT_DELAY_MS),
    }
  })

  const [recap, setRecap] = createSignal<string>()
  let cancelPending: (() => void) | undefined
  // One recap per turn: remembers which user message the recap was scheduled for.
  let lastRecapTurn: string | undefined

  function promptInput() {
    return promptRef.current?.current.input ?? ""
  }

  function cancelScheduled() {
    cancelPending?.()
    cancelPending = undefined
  }

  function dismiss() {
    setRecap(undefined)
  }

  function reset() {
    cancelScheduled()
    dismiss()
    lastRecapTurn = undefined
  }

  onCleanup(reset)

  // Session switch / route change: drop any banner or pending request.
  createEffect(on(() => props.sessionID, reset))

  const status = createMemo(() => footerSessionStatusOrIdle(sync.data.session_status?.[props.sessionID]).type)
  const lastTurnID = createMemo(() => {
    const msgs = sync.data.message[props.sessionID] ?? []
    return msgs.findLast((message) => message.role === "user")?.id
  })
  const hasAssistant = createMemo(() =>
    (sync.data.message[props.sessionID] ?? []).some((message) => message.role === "assistant"),
  )

  createEffect(
    on(
      status,
      (current, previous) => {
        if (current !== "idle") {
          // A new turn (or retry) started — drop any banner immediately.
          cancelScheduled()
          dismiss()
          return
        }
        // Fire only on a busy/retry -> idle transition; the deferred effect
        // means the initial mount state never counts as a transition.
        if (previous === "idle") return
        schedule()
      },
      { defer: true },
    ),
  )

  function schedule() {
    cancelScheduled()
    if (!config().enabled) return
    if (!hasAssistant()) return
    const turnID = lastTurnID()
    if (!turnID || turnID === lastRecapTurn) return
    lastRecapTurn = turnID
    cancelPending = scheduleTuiTimeout(
      () => {
        cancelPending = undefined
        return requestRecap(turnID)
      },
      {
        name: "idle-recap",
        delayMs: config().delayMs,
        unref: true,
      },
    )
  }

  async function requestRecap(turnID: string) {
    // The user started typing during the delay — stay silent.
    if (promptInput() !== "") return
    if (!config().enabled) return
    try {
      const result = await sdk.client.session.recap({ sessionID: props.sessionID })
      // The v2 SDK client resolves { error } instead of rejecting, so HTTP
      // errors must be checked here — the catch below never fires for them.
      if (result?.error) return
      const text = result.data?.text
      if (!text) return
      // The turn restarted or the user typed while the request was in flight.
      if (status() !== "idle" || promptInput() !== "") return
      if (lastTurnID() !== turnID) return
      setRecap(text)
    } catch {
      // Best-effort only — never surface errors to the user.
    }
  }

  // While the banner is visible, poll the (imperative, non-reactive) prompt
  // input and dismiss as soon as the user starts typing.
  createEffect(() => {
    if (!recap()) return
    const cancel = scheduleTuiInterval(
      () => {
        if (promptInput() !== "") dismiss()
      },
      {
        name: "idle-recap-dismiss",
        delayMs: DISMISS_POLL_MS,
        unref: true,
      },
    )
    onCleanup(cancel)
  })

  return (
    <Show when={recap()}>
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
              <span style={{ fg: theme.text, bold: true }}>Recap</span>
              {" · "}
              {text()}
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}
