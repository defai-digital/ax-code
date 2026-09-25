import { useLanguage } from "@tui/context/language"
import { createMemo, createSignal } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import {
  durableFollowUps,
  followUpAction,
  pauseFollowUp,
  followUpBody,
  followUpStatus,
  type DurableFollowUp,
} from "./prompt/durable-follow-up"
import { Keybind } from "@/util/keybind"

export function DialogFollowUps(props: { sessionID: string; onAttention: () => void }) {
  const uiText = useLanguage().t

  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [history, showHistory] = createSignal(false)
  const items = createMemo(() => durableFollowUps(sync.data.task_queue, props.sessionID, history()))
  const update = (item: DurableFollowUp) =>
    sync.set("task_queue", (rows) => [...rows.filter((row) => row.id !== item.id), item])
  const reopen = () =>
    dialog.replace(() => <DialogFollowUps sessionID={props.sessionID} onAttention={props.onAttention} />)

  async function act(item: DurableFollowUp, action: "pause" | "resume" | "cancel" | "retry" | "edit" | "stop") {
    try {
      if (action === "stop") {
        if (!sdk.sseConnected) throw new Error("Reconnect before stopping the active turn")
        const result = await sdk.client.session.abort({ sessionID: props.sessionID })
        if (result.error) throw new Error("Unable to stop the active turn")
      } else if (action !== "edit") update(await followUpAction(sdk, item.id, action))
      else {
        const paused = await pauseFollowUp(sdk, item.id)
        update(paused)
        const body = followUpBody(paused)
        const index = body.parts.findIndex((part) => part.type === "text")
        const text = await DialogPrompt.show(dialog, "Edit paused follow-up", {
          value: index < 0 ? "" : body.parts[index].text,
        })
        if (text !== null) {
          const parts = [...body.parts]
          if (index < 0) parts.unshift({ type: "text", text })
          else parts[index] = { ...parts[index], text }
          update(
            await followUpAction(sdk, item.id, "edit", {
              expectedUpdatedAt: paused.time.updated,
              title: text.trim().slice(0, 200) || "Follow-up",
              payload: { ...paused.payload, body: { ...body, parts } },
            }),
          )
          toast.show({ message: uiText("ui.savedFollowUpRemainsPausedUntilResumed"), variant: "info" })
        }
      }
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "Follow-up action failed", variant: "error" })
    }
    reopen()
  }

  function select(item: DurableFollowUp) {
    if (["completed", "cancelled"].includes(item.status)) return
    if (["blocked_permission", "blocked_question"].includes(item.status)) {
      dialog.clear()
      props.onAttention()
      return
    }
    const mutable = ["queued", "waiting_for_idle", "paused"].includes(item.status)
    const actions: Array<{ title: string; value: "pause" | "resume" | "cancel" | "retry" | "edit" | "stop" }> = [
      ...(mutable ? [{ title: uiText("ui.editPauseFirst"), value: "edit" as const }] : []),
      ...(item.status === "paused"
        ? [{ title: uiText("ui.resume"), value: "resume" as const }]
        : mutable
          ? [{ title: uiText("ui.pause"), value: "pause" as const }]
          : []),
      ...(item.status === "failed"
        ? [{ title: uiText("ui.retryAfterInspectingPreviousOutput"), value: "retry" as const }]
        : []),
      ...(mutable ? [{ title: uiText("ui.cancelFollowUp"), value: "cancel" as const }] : []),
      ...(item.status === "running" ? [{ title: uiText("ui.stopActiveTurn"), value: "stop" as const }] : []),
    ]
    dialog.replace(() => (
      <DialogSelect
        title={followUpStatus(item)}
        options={actions}
        onSelect={(option) => void act(item, option.value)}
      />
    ))
  }

  return (
    <DialogSelect
      title={sdk.sseConnected ? "Saved follow-ups" : "Saved follow-ups (cached)"}
      keybind={[
        {
          title: history() ? "pending only" : "include history",
          keybind: Keybind.parse("ctrl+r")[0],
          onTrigger: () => showHistory((value) => !value),
        },
      ]}
      placeholder={items().length ? "Choose a follow-up" : "No pending follow-ups"}
      options={[
        ...items().map((item) => ({
          title: item.title,
          value: item as DurableFollowUp | null,
          description: followUpStatus(item),
        })),
        {
          title: history() ? "Show pending only" : "Show completed and cancelled history",
          value: null,
          description: uiText("ui.toggleHistory"),
        },
      ]}
      onSelect={(option) => (option.value ? select(option.value) : showHistory((value) => !value))}
    />
  )
}
