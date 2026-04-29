import { createMemo, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { useDialog } from "../../ui/dialog"
import { SessionDreView } from "./dre"
import { SessionSemanticDiff } from "@/session/semantic-diff"

export function DialogDre(props: { sessionID: string }) {
  const dialog = useDialog()
  const sync = useSync()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const detail = SessionDreView.loadDetail(props.sessionID as Parameters<typeof SessionDreView.loadDetail>[0])
    if (!detail) {
      return [
        {
          title: "No analysis data yet",
          value: "empty",
          description: "Analysis populates after the session uses tools or agent routes. Keep chatting.",
          category: "Overview",
        },
      ]
    }
    const semantic = SessionSemanticDiff.summarize(sync.data.session_diff[props.sessionID] ?? []) ?? null
    return SessionDreView.entries(SessionDreView.merge(detail, semantic)).map((item) => ({
      title: item.title,
      value: item.id,
      description: item.description,
      footer: item.footer,
      category: item.category,
    }))
  })

  return <DialogSelect title="Analysis" options={options()} skipFilter={false} />
}
