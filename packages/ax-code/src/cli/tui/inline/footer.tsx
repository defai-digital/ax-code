import { Show } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { durableFollowUps } from "../component/prompt/durable-follow-up"
import type { PromptRef } from "../component/prompt"
import { FooterPrompt } from "./footer-prompt"
import { singleLine } from "./block-format"

export function InlineFooter(props: {
  sessionID?: string
  preview: string
  height: number
  onRows: (rows: number) => void
  promptRef?: (ref: PromptRef) => void
}) {
  const local = useLocal()
  const sync = useSync()
  const { theme } = useTheme()
  const busy = () => (sync.data.session_status[props.sessionID ?? ""]?.type ?? "idle") !== "idle"
  return (
    <box flexDirection="column" height={props.height} overflow="hidden">
      <Show when={props.preview}>
        <text height={1} wrapMode="none" fg={theme.textMuted}>
          {singleLine(props.preview)}
        </text>
      </Show>
      <FooterPrompt
        sessionID={props.sessionID}
        rows={Math.max(1, props.height - 3 - Number(!!props.preview))}
        onRows={props.onRows}
        ref={props.promptRef}
      />
      <text height={1} wrapMode="none" fg={theme.textMuted}>
        {local.agent.current().name} | {local.model.current()?.modelID ?? "no model"} | {busy() ? "busy" : "idle"} |
        queued {durableFollowUps(sync.data.task_queue, props.sessionID ?? "").length}
      </text>
    </box>
  )
}
