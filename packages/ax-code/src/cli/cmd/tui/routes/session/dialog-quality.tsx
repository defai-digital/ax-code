import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { PromptInfo } from "../../component/prompt/history"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { Clipboard } from "../../util/clipboard"
import { DialogActivity } from "./dialog-activity"
import {
  findSessionQualityAction,
  renderSessionQualityBrief,
  sessionQualityActions,
  sessionQualityActionValue,
  sessionQualityDetailItems,
  sessionQualityWorkflowLabel,
  type SessionQualityAction,
  type SessionQualityActionKind,
  type SessionQualityWorkflow,
} from "./quality"

export function DialogQuality(props: { sessionID: string; setPrompt: (prompt: PromptInfo) => void }) {
  const sync = useSync()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const actions = sessionQualityActions({
      sessionID: props.sessionID,
      quality: sync.session.risk(props.sessionID)?.quality,
    })

    if (actions.length === 0) {
      return [
        {
          title: "No quality readiness available",
          value: "empty",
          description:
            "Replay readiness appears after session risk sync finishes or after workflow evidence is recorded.",
          category: "Overview",
          disabled: true,
        },
      ]
    }

    return actions.map((action) => ({
      title: action.title,
      value: sessionQualityActionValue(action),
      description: action.description,
      footer: action.footer,
      category: sessionQualityWorkflowLabel(action.workflow),
      onSelect: (ctx) => {
        ctx.replace(() => (
          <DialogQualityDetail
            sessionID={props.sessionID}
            workflow={action.workflow}
            kind={action.kind}
            setPrompt={props.setPrompt}
          />
        ))
      },
    }))
  })

  return <DialogSelect title="Quality Readiness" options={options()} skipFilter={false} />
}

export function DialogQualityDetail(props: {
  sessionID: string
  workflow: SessionQualityWorkflow
  kind: SessionQualityActionKind
  setPrompt: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  onMount(() => {
    dialog.setSize("large")
  })

  const action = createMemo(() =>
    findSessionQualityAction({
      sessionID: props.sessionID,
      workflow: props.workflow,
      kind: props.kind,
      quality: sync.session.risk(props.sessionID)?.quality,
    }),
  )

  const options = createMemo((): DialogSelectOption<string>[] => {
    const current = action()
    const result: DialogSelectOption<string>[] = [
      {
        title: "Refresh readiness",
        value: "quality.refresh",
        description: "Re-sync the session risk snapshot and refresh quality readiness in place.",
        category: "Actions",
        onSelect: async () => {
          await sync.session
            .sync(props.sessionID, { force: true })
            .then(() => {
              toast.show({ message: "Quality readiness refreshed", variant: "success" })
            })
            .catch((error) => {
              toast.show({
                message: error instanceof Error ? error.message : "Failed to refresh quality readiness",
                variant: "error",
              })
            })
        },
      },
      {
        title: "Copy next-step prompt",
        value: "quality.copy-prompt",
        description: "Copy the current action's prompt scaffold to the clipboard.",
        category: "Actions",
        onSelect: async () => {
          const current = action()
          if (!current) {
            toast.show({ message: "Quality readiness is no longer available", variant: "warning" })
            return
          }
          await Clipboard.copy(current.prompt.input)
            .then(() => {
              toast.show({ message: "Copied quality next-step prompt", variant: "success" })
            })
            .catch((error) => {
              toast.show({
                message: error instanceof Error ? error.message : "Failed to copy quality next-step prompt",
                variant: "error",
              })
            })
        },
      },
      {
        title: "Copy readiness brief",
        value: "quality.copy-brief",
        description: "Copy the current quality readiness summary and gate details to the clipboard.",
        category: "Actions",
        onSelect: async () => {
          const current = action()
          if (!current) {
            toast.show({ message: "Quality readiness is no longer available", variant: "warning" })
            return
          }
          await Clipboard.copy(renderSessionQualityBrief(current))
            .then(() => {
              toast.show({ message: "Copied quality readiness brief", variant: "success" })
            })
            .catch((error) => {
              toast.show({
                message: error instanceof Error ? error.message : "Failed to copy quality readiness brief",
                variant: "error",
              })
            })
        },
      },
      {
        title: "View activity history",
        value: "quality.activity",
        description: "Inspect recent session activity to verify workflow evidence and tool output.",
        category: "Actions",
        onSelect: (ctx) => {
          ctx.replace(() => <DialogActivity sessionID={props.sessionID} />)
        },
      },
    ]

    if (!current) {
      result.push({
        title: "Quality action unavailable",
        value: "quality.unavailable",
        description: "This readiness action is no longer available for the current session snapshot.",
        category: "Overview",
        disabled: true,
      })
      return result
    }

    return [
      ...result,
      ...sessionQualityDetailItems(current).map((item) => ({
        title: item.title,
        value: item.id,
        description: item.description,
        footer: item.footer,
        category: item.category,
        onSelect: item.action
          ? (ctx: DialogContext) => {
              props.setPrompt(item.action!.prompt)
              ctx.clear()
            }
          : undefined,
      })),
    ]
  })

  return (
    <DialogSelect
      title={`${sessionQualityWorkflowLabel(props.workflow)} Quality`}
      options={options()}
      skipFilter={false}
    />
  )
}
