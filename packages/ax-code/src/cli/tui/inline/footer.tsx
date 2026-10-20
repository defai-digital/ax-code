import { PermissionPrompt } from "../routes/session/permission"
import { QuestionPrompt } from "../routes/session/question"
import { useDialog } from "../ui/dialog"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { useLanguage } from "../context/language"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { durableFollowUps } from "../component/prompt/durable-follow-up"
import type { PromptRef } from "../component/prompt"
import { FooterPrompt } from "./footer-prompt"
import { singleLine } from "./block-format"

export function InlineFooter(props: {
  onDecision: (id: string, text: string) => void
  sessionID?: string
  preview: string
  height: number
  onRows: (rows: number) => void
  promptRef?: (ref: PromptRef) => void
}) {
  const dialog = useDialog()
  const t = useLanguage().t
  const permission = () => sync.data.permission[props.sessionID ?? ""]?.[0]
  const question = () => sync.data.question[props.sessionID ?? ""]?.[0]
  const local = useLocal()
  const sync = useSync()
  const { theme } = useTheme()
  const busy = () => (sync.data.session_status[props.sessionID ?? ""]?.type ?? "idle") !== "idle"
  return (
    <box flexDirection="column" height={props.height} overflow="hidden">
      <box visible={dialog.stack.length === 0}>
        <Show
          when={permission()}
          fallback={
            <Show when={question()}>
              {(request) => (
                <QuestionPrompt
                  request={request()}
                  surface="footer"
                  onDecision={(id, rejected) =>
                    props.onDecision(id, t(rejected ? "ui.inlineQuestionDismissed" : "ui.inlineQuestionAnswered"))
                  }
                />
              )}
            </Show>
          }
        >
          {(request) => (
            <PermissionPrompt
              request={request()}
              surface="footer"
              onDecision={(id, decision, permission) =>
                props.onDecision(
                  id,
                  t(
                    decision === "reject"
                      ? "ui.inlineDenied"
                      : decision === "always"
                        ? "ui.inlineAllowedAlways"
                        : "ui.inlineAllowedOnce",
                    { permission: singleLine(permission) },
                  ),
                )
              }
            />
          )}
        </Show>
      </box>
      <Show when={dialog.stack.at(-1)}>
        {(item) => (
          <box height={props.height} overflow="hidden">
            {item().element as JSX.Element}
          </box>
        )}
      </Show>
      <box visible={!permission() && !question() && dialog.stack.length === 0}>
        <Show when={props.preview}>
          <text height={1} wrapMode="none" fg={theme.textMuted}>
            {singleLine(props.preview)}
          </text>
        </Show>
        <FooterPrompt
          disabled={!!permission() || !!question() || dialog.stack.length > 0}
          sessionID={props.sessionID}
          rows={Math.max(1, props.height - 3 - Number(!!props.preview))}
          onRows={props.onRows}
          ref={props.promptRef}
        />
      </box>
      <text height={1} wrapMode="none" fg={theme.textMuted}>
        {local.agent.current().name} | {local.model.current()?.modelID ?? "no model"} | {busy() ? "busy" : "idle"} |
        queued {durableFollowUps(sync.data.task_queue, props.sessionID ?? "").length}
      </text>
    </box>
  )
}
