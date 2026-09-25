import { useLanguage } from "@tui/context/language"
import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useDialog } from "../../ui/dialog"
import { SessionCompareView } from "./compare"
import { SessionSemanticDiff } from "@/session/semantic-diff"

export function DialogCompare(props: { currentID: string; sessions: SessionCompareView.Session[] }) {
  const uiText = useLanguage().t

  const dialog = useDialog()
  const sync = useSync()

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
    const items = SessionCompareView.targets({
      currentID: props.currentID,
      sessions: props.sessions,
      semantic,
    })
    if (items.length === 0) {
      return [
        {
          title: uiText("ui.noCompareTargetAvailable"),
          value: "empty",
          description: uiText("ui.createAForkFromThisSessionToCompareAlternatives"),
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

  return <DialogSelect title={uiText("ui.compareSessions")} options={options()} skipFilter={false} />
}

export function DialogCompareDetail(props: {
  currentID: string
  otherID: string
  sessions: SessionCompareView.Session[]
}) {
  const uiText = useLanguage().t

  const dialog = useDialog()
  const sync = useSync()

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
    const detail = SessionCompareView.detail({
      currentID: props.currentID,
      otherID: props.otherID,
      sessions: props.sessions,
      deep: true,
      semantic,
    })
    if (!detail) {
      return [
        {
          title: uiText("ui.compareTargetMissing"),
          value: "missing",
          description: uiText("ui.theSelectedBranchIsNoLongerAvailable"),
          category: "Overview",
        },
      ]
    }

    return SessionCompareView.entries(detail).map((item) => ({
      title: item.title,
      value: item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
    }))
  })

  return <DialogSelect title={uiText("ui.executionCompare")} options={options()} skipFilter={false} />
}
