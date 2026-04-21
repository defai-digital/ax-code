import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { PromptInfo } from "../../component/prompt/history"
import { useDialog } from "../../ui/dialog"
import { sessionQualityActions } from "./quality"

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
          description: "Replay readiness appears after session risk sync finishes or after workflow evidence is recorded.",
          category: "Overview",
          disabled: true,
        },
      ]
    }

    return actions.map((action) => ({
      title: action.title,
      value: `${action.workflow}:${action.kind}`,
      description: action.description,
      footer: action.footer,
      category: action.workflow === "review" ? "Review" : "Debug",
      onSelect: (ctx) => {
        props.setPrompt(action.prompt)
        ctx.clear()
      },
    }))
  })

  return <DialogSelect title="Quality Readiness" options={options()} skipFilter={false} />
}
