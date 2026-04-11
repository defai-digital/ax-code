import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useDialog } from "../../ui/dialog"
import { SessionCompare } from "./compare"
import { SessionSemanticDiff } from "@/session/semantic-diff"

export function DialogCompare(props: { currentID: string; sessions: SessionCompare.Session[] }) {
  const dialog = useDialog()
  const sync = useSync()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const semantic = Object.fromEntries(
      props.sessions.map((item) => [item.id, SessionSemanticDiff.summarize(sync.data.session_diff[item.id] ?? []) ?? null]),
    )
    const items = SessionCompare.targets({
      currentID: props.currentID,
      sessions: props.sessions,
      semantic,
    })
    if (items.length === 0) {
      return [
        {
          title: "No compare target available",
          value: "empty",
          description: "Create a fork from this session to compare alternatives.",
          category: "Overview",
        },
      ]
    }

    return items.map((item) => ({
      title: item.title,
      value: item.sessionID ?? item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
      onSelect: item.sessionID
        ? (dialog) =>
            dialog.replace(() => (
              <DialogCompareDetail currentID={props.currentID} otherID={item.sessionID!} sessions={props.sessions} />
            ))
        : undefined,
    }))
  })

  return <DialogSelect title="Compare Sessions" options={options()} skipFilter={false} />
}

export function DialogCompareDetail(props: { currentID: string; otherID: string; sessions: SessionCompare.Session[] }) {
  const dialog = useDialog()
  const sync = useSync()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const semantic = Object.fromEntries(
      props.sessions.map((item) => [item.id, SessionSemanticDiff.summarize(sync.data.session_diff[item.id] ?? []) ?? null]),
    )
    const detail = SessionCompare.detail({
      currentID: props.currentID,
      otherID: props.otherID,
      sessions: props.sessions,
      deep: true,
      semantic,
    })
    if (!detail) {
      return [
        {
          title: "Compare target missing",
          value: "missing",
          description: "The selected branch is no longer available.",
          category: "Overview",
        },
      ]
    }

    return SessionCompare.entries(detail).map((item) => ({
      title: item.title,
      value: item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
    }))
  })

  return <DialogSelect title="Execution Compare" options={options()} skipFilter={false} />
}
