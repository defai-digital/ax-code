import { useLanguage } from "@tui/context/language"
import { useTheme } from "@tui/context/theme"
import { transcriptFollowLabel } from "./transcript-follow"

/** Overlay: showing the control never changes the transcript viewport height. */
export function TranscriptFollowIndicator(props: { unread: boolean; columns: number; onReturn: () => void }) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  return (
    <box position="absolute" bottom={0} left={0} right={2} height={1} alignItems="center">
      <text
        height={1}
        maxWidth="100%"
        wrapMode="none"
        selectable={false}
        fg={theme.primary}
        bg={theme.backgroundElement}
        onMouseUp={(event) => {
          event.stopPropagation()
          if (event.button === 0) props.onReturn()
        }}
      >
        {transcriptFollowLabel({
          unread: props.unread,
          columns: Math.max(0, props.columns - 2),
          activity: t("ui.transcriptNewActivity"),
          bottom: t("ui.transcriptBackToBottom"),
        })}
      </text>
    </box>
  )
}
