import { useLanguage } from "../context/language"
import { createSignal, type JSX } from "solid-js"
import { TextAttributes } from "ax-tui"
import { useTheme } from "@tui/context/theme"

/** Sidebar chrome control. Muted by default, brightens on hover; link=true renders an underlined link-colored action. Clicks stay on the wrapper box. */
export function ChromeAction(props: { onMouseUp: () => void; children: JSX.Element; link?: boolean }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <box
      flexShrink={0}
      backgroundColor={hover() ? theme.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onMouseUp}
    >
      <text
        flexShrink={0}
        fg={props.link ? theme.markdownLink : hover() ? theme.text : theme.textMuted}
        attributes={props.link ? TextAttributes.UNDERLINE : undefined}
        selectable={false}
      >
        {props.children}
      </text>
    </box>
  )
}

/** Both rails use one reactive width label; only the command and value differ. */
export function ChromeWidthAction(props: { width: number; onMouseUp: () => void }) {
  const { t } = useLanguage()
  return <ChromeAction onMouseUp={props.onMouseUp}>{t("ui.widthWidth", { width: props.width })}</ChromeAction>
}
