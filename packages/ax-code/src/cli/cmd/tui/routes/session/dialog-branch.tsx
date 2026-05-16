import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { type DialogContext, useDialog } from "../../ui/dialog"
import { SessionBranch } from "./branch"
import { DialogCompareDetail } from "./dialog-compare"
import { SessionSemanticDiff } from "@/session/semantic-diff"

export function DialogBranch(props: {
  currentID: string
  sessions: SessionBranch.Session[]
  onSelect: (sessionID: string) => void
  onContinue?: (sessionID: string) => void
}) {
  const dialog = useDialog()
  const sync = useSync()
  const go = (sessionID: string) => (props.onContinue ?? props.onSelect)(sessionID)

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const semantic = Object.fromEntries(
      props.sessions.map((item) => [
        item.id,
        SessionSemanticDiff.summarize(sync.data.session_diff[item.id] ?? []) ?? null,
      ]),
    )
    const detail = SessionBranch.detail({ currentID: props.currentID, sessions: props.sessions, semantic })
    if (!detail || detail.items.length <= 1) {
      return [
        {
          title: "No branch family recorded",
          value: "empty",
          description: "Create a fork from this session to compare alternatives.",
          category: "Overview",
        },
      ]
    }

    return [
      ...SessionBranch.continueEntries(detail).map((item) => ({
        title: item.title,
        value: item.id,
        description: item.description,
        footer: item.footer,
        category: item.category,
        onSelect: item.sessionID
          ? (dialog: DialogContext) => {
              go(item.sessionID!)
              dialog.clear()
            }
          : undefined,
      })),
      ...SessionBranch.entries(detail).map((item) => ({
        title: item.title,
        value: item.sessionID ?? item.id,
        description: item.description,
        footer: item.footer,
        category: item.category,
        onSelect: item.sessionID
          ? (dialog: DialogContext) => {
              props.onSelect(item.sessionID!)
              dialog.clear()
            }
          : undefined,
      })),
      ...SessionBranch.compareEntries(detail).map((item) => ({
        title: item.title,
        value: item.id,
        description: item.description,
        footer: item.footer,
        category: item.category,
        onSelect: item.sessionID
          ? (dialog: DialogContext) =>
              dialog.replace(() => (
                <DialogCompareDetail currentID={props.currentID} otherID={item.sessionID!} sessions={props.sessions} />
              ))
          : undefined,
      })),
    ]
  })

  return <DialogSelect current={props.currentID} title="Branch Ranking" options={options()} skipFilter={false} />
}
