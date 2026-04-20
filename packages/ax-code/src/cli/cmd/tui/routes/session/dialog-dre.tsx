import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useDialog } from "../../ui/dialog"
import { SessionDre } from "./dre"
import { SessionSemanticDiff } from "@/session/semantic-diff"

export function DialogDre(props: { sessionID: string }) {
  const dialog = useDialog()
  const sync = useSync()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const detail = SessionDre.loadDetail(props.sessionID as Parameters<typeof SessionDre.loadDetail>[0])
    if (!detail) {
      return [
        {
          title: "No DRE data recorded",
          value: "empty",
          description: "Run a session with tools or routes to populate execution evidence.",
          category: "Overview",
        },
      ]
    }
    const semantic = SessionSemanticDiff.summarize(sync.data.session_diff[props.sessionID] ?? []) ?? null
    return SessionDre.entries(SessionDre.merge(detail, semantic)).map((item) => ({
      title: item.title,
      value: item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
    }))
  })

  return <DialogSelect title="DRE Details" options={options()} skipFilter={false} />
}
