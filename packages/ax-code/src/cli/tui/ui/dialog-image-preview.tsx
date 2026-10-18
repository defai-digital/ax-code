import type { FilePart } from "@ax-code/sdk/v2"
import { TextAttributes } from "ax-tui"
import { useTerminalDimensions } from "ax-tui/solid"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@tui/context/language"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { imagePreviewLabel, imagePreviewSource } from "./image-preview-source"

export function DialogImagePreview(props: { file: FilePart }) {
  const dialog = useDialog()
  const { t } = useLanguage()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const label = () => imagePreviewLabel(props.file.filename ?? props.file.mime)
  const source = async (signal: AbortSignal) => {
    signal.throwIfAborted()
    return imagePreviewSource(props.file)
  }
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text} wrapMode="none">
          {label()}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>{imagePreviewLabel(props.file.mime)} · PNG ≤ 2 MiB · ≤ 1 MP</text>
      <image
        width="100%"
        height={Math.max(1, Math.min(18, dimensions().height - 10))}
        source={source}
        fit="contain"
        protocol="auto"
        backgroundColor={theme.backgroundPanel}
        alt={label()}
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
      <Show when={state() !== "ready"}>
        <text fg={state() === "error" ? theme.warning : theme.textMuted}>
          {state() === "error" ? `${t("ui.failedToRender")}: ${label()}` : t("ui.loading")}
        </text>
      </Show>
    </box>
  )
}
