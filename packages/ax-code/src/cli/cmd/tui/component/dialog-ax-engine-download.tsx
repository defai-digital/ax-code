import { DialogSelect } from "@tui/ui/dialog-select"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import type { useSDK } from "../context/sdk"
import type { useToast } from "../ui/toast"

// Minimal projections of /provider/ax-engine/models and /connection responses —
// only the fields this dialog reads. The server catalog is the authority.
type AxEngineCatalogModel = {
  id: string
  name: string
  quantization: string
  hfRepo: string
  minDiskBytes: number
  local?: { present?: boolean }
  fit?: { state?: string }
}

export type AxEngineDownloadOffer = {
  modelID: string
  name: string
  quantization: string
  hfRepo: string
  requiredGiB: number
}

/**
 * Decide whether selecting `modelID` should first offer a managed download.
 * Returns undefined when the model is already downloaded, already downloading,
 * blocked for another reason (the loader surfaces those), served by an
 * attached external server, or unknown to the managed catalog.
 */
export async function fetchAxEngineDownloadOffer(
  sdk: ReturnType<typeof useSDK>,
  modelID: string,
): Promise<AxEngineDownloadOffer | undefined> {
  const headers = directoryRequestHeaders({ directory: sdk.directory })
  const connectionResponse = await sdk.fetch(new URL("/provider/ax-engine/connection", sdk.url), { headers })
  if (connectionResponse.ok) {
    const connection = (await connectionResponse.json()) as { mode?: string }
    if (connection.mode === "attach") return undefined
  }
  const response = await sdk.fetch(new URL("/provider/ax-engine/models", sdk.url), { headers })
  if (!response.ok) return undefined
  const catalog = (await response.json()) as { models?: AxEngineCatalogModel[] }
  const entry = catalog.models?.find((model) => model.id === modelID)
  if (!entry) return undefined
  if (entry.local?.present) return undefined
  if (entry.fit?.state !== "downloadable") return undefined
  return {
    modelID: entry.id,
    name: entry.name,
    quantization: entry.quantization,
    hfRepo: entry.hfRepo,
    requiredGiB: Math.ceil(entry.minDiskBytes / 1024 ** 3),
  }
}

async function startAxEngineDownload(sdk: ReturnType<typeof useSDK>, offer: AxEngineDownloadOffer): Promise<void> {
  const response = await sdk.fetch(
    new URL(`/provider/ax-engine/models/${encodeURIComponent(offer.modelID)}/download`, sdk.url),
    {
      method: "POST",
      headers: directoryRequestHeaders({ directory: sdk.directory, contentType: "application/json" }),
      body: JSON.stringify({ quantization: offer.quantization }),
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `Download request failed with HTTP ${response.status}`)
  }
}

/**
 * "Model not downloaded" offer shown when the user picks a managed AX Engine
 * model whose weights are missing. Either path keeps the selection — the
 * question is only who fetches the weights from Hugging Face.
 */
export function DialogAxEngineDownload(props: {
  offer: AxEngineDownloadOffer
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
  onApplySelection: () => void
}) {
  return (
    <DialogSelect<string>
      title={`${props.offer.name} is not downloaded`}
      flat={true}
      options={[
        {
          value: "download",
          title: `Download now with ax-code (needs ~${props.offer.requiredGiB} GiB free)`,
          description: `From Hugging Face: ${props.offer.hfRepo}`,
          onSelect: (dialog) => {
            dialog.clear()
            props.onApplySelection()
            return startAxEngineDownload(props.sdk, props.offer).then(
              () => {
                props.toast.show({
                  variant: "success",
                  message: `Downloading ${props.offer.name} in the background — it becomes usable when the download completes`,
                })
              },
              (error: unknown) => {
                props.toast.show({
                  variant: "error",
                  message: error instanceof Error ? error.message : "Failed to start the model download",
                })
              },
            )
          },
        },
        {
          value: "self",
          title: "I'll download it myself",
          description: `ax-engine download ${props.offer.hfRepo}`,
          onSelect: (dialog) => {
            dialog.clear()
            props.onApplySelection()
            props.toast.show({
              variant: "info",
              message: `Run: ax-engine download ${props.offer.hfRepo}`,
            })
          },
        },
      ]}
    />
  )
}
