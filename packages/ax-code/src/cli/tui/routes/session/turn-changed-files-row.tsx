import { createSignal } from "solid-js"
import { useLanguage } from "@tui/context/language"
import { useTheme } from "@tui/context/theme"
import { formatTurnChangedFilesRow, type TurnChangedFiles } from "./turn-changed-files-view-model"

/** Compact "files changed in this turn" row (ADR-250). Selecting it opens the diff viewer. */
export function TurnChangedFilesRow(props: { row: TurnChangedFiles; onOpen: () => void }) {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const summary = () =>
    t(props.row.count === 1 ? "turn.changedFiles.one" : "turn.changedFiles.many", {
      count: props.row.count,
      additions: props.row.additions,
      deletions: props.row.deletions,
    })
  const names = () => formatTurnChangedFilesRow(props.row).split(": ").slice(1).join(": ")
  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onOpen}
      marginTop={1}
      flexShrink={0}
    >
      <box paddingLeft={2} backgroundColor={hover() ? theme.backgroundElement : undefined}>
        <text fg={theme.textMuted}>
          {summary()}
          {names() ? `: ${names()}` : ""}
        </text>
      </box>
    </box>
  )
}
