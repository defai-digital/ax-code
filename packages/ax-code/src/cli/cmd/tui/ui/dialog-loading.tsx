import { TextAttributes } from "@opentui/core"
import type { JSX } from "solid-js"
import { Spinner } from "../component/spinner"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"

export type DialogLoadingProps = {
  title: string
  message: string
}

export function DialogLoading(props: DialogLoadingProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <Spinner color={theme.textMuted}>{props.message}</Spinner>
      </box>
    </box>
  )
}

export function renderDialogLoading(props: DialogLoadingProps): JSX.Element {
  return <DialogLoading {...props} />
}
