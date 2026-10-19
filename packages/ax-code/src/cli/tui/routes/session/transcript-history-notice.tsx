import { useLanguage } from "@tui/context/language"
import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"

export function TranscriptHistoryNotice(props: { count: number; max: number; loading: boolean; onLoad: () => void }) {
  const uiText = useLanguage().t
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingBottom={1}>
      <text fg={theme.textMuted}>
        {props.count >= props.max
          ? uiText("ui.transcriptLoadLimitReached", { count: props.count })
          : uiText("ui.showingLatestMessages", { count: props.count })}
      </text>
      <Show when={props.count < props.max}>
        <text fg={theme.text} onMouseUp={() => props.onLoad()}>
          {props.loading ? uiText("ui.loadingEarlierMessages") : uiText("ui.loadEarlierMessages")}
        </text>
      </Show>
    </box>
  )
}
