import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useLanguage } from "./language"
import { useToast } from "../ui/toast"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { Clipboard } from "../util/clipboard"
import { createWikiVisualizationManager, fetchWikiVisualization, WikiVizError } from "../util/wiki-visualization"

export const { use: useWikiVisualization, provider: WikiVisualizationProvider } = createSimpleContext({
  name: "WikiVisualization",
  init: (props: { manager: ReturnType<typeof createWikiVisualizationManager> }) => {
    const sdk = useSDK()
    const t = useLanguage().t
    const toast = useToast()
    const dialog = useDialog()
    const [opening, setOpening] = createSignal(false)
    onCleanup(props.manager.subscribe(setOpening))
    async function open(directory?: () => string | undefined) {
      const base = sdk.url
      const transport = sdk.fetch
      const client = sdk.client
      const scopeDirectory = sdk.directory
      const capturedDirectory = scopeDirectory ?? directory?.()
      try {
        const result = await props.manager.activate({
          scope: JSON.stringify([base, capturedDirectory]),
          load: (signal) => fetchWikiVisualization({ base, directory: capturedDirectory, fetch: transport, signal }),
          isCurrent: () =>
            sdk.url === base &&
            sdk.fetch === transport &&
            sdk.client === client &&
            sdk.directory === scopeDirectory &&
            (scopeDirectory !== undefined || directory?.() === capturedDirectory),
        })
        if (result.opened) return
        dialog.replace(() => (
          <DialogSelect
            title={t("ui.wikiBrowserFallback")}
            skipFilter
            options={[
              {
                title: t("ui.copy"),
                value: "copy",
                footer: result.url,
                onSelect: () => {
                  void Clipboard.copy(result.url)
                    .then(() => {
                      dialog.clear()
                      toast.show({ message: t("ui.copiedToClipboard"), variant: "success" })
                    })
                    .catch(() => toast.show({ message: t("ui.failedToCopyToClipboard"), variant: "error" }))
                },
              },
              {
                title: t("ui.open"),
                value: "retry",
                onSelect: () => {
                  dialog.clear()
                  void open(directory)
                },
              },
            ]}
          />
        ))
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return
        const reason = WikiVizError.isInstance(error) ? error.data.reason : "failed"
        const key =
          reason === "missing"
            ? "ui.wikiSnapshotMissing"
            : reason === "unsupported"
              ? "ui.wikiUnsupportedRuntime"
              : "ui.wikiRequestFailed"
        toast.show({ message: t(key), variant: "error", duration: 7000 })
      }
    }
    return { open, opening }
  },
})
