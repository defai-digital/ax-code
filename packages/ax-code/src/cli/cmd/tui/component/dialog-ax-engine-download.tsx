import { DialogSelect } from "@tui/ui/dialog-select"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import type { useSDK } from "../context/sdk"
import type { useToast } from "../ui/toast"
import { axEngineModelStateAnnotations, type AxEngineCatalogEntryState } from "./dialog-ax-engine-state"

// Minimal projections of /provider/ax-engine/models and /connection responses —
// only the fields this dialog reads. The server catalog is the authority.
type AxEngineCatalogModel = AxEngineCatalogEntryState & {
  id: string
  name: string
  quantization: string
  hfRepo: string
  minDiskBytes: number
}

type AxEngineCatalog = { models?: AxEngineCatalogModel[] }

/**
 * Fetch the managed catalog, or undefined when local download semantics do not
 * apply (attach mode serves weights from an external server) or the probe
 * fails. Callers treat undefined as "no information", never as a blocker.
 */
async function fetchAxEngineCatalog(sdk: ReturnType<typeof useSDK>): Promise<AxEngineCatalog | undefined> {
  const headers = directoryRequestHeaders({ directory: sdk.directory })
  const connectionResponse = await sdk.fetch(new URL("/provider/ax-engine/connection", sdk.url), { headers })
  if (connectionResponse.ok) {
    const connection = (await connectionResponse.json()) as { mode?: string }
    if (connection.mode === "attach") return undefined
  }
  const response = await sdk.fetch(new URL("/provider/ax-engine/models", sdk.url), { headers })
  if (!response.ok) return undefined
  return (await response.json()) as AxEngineCatalog
}

/**
 * modelID → picker annotation ("Not downloaded", "Downloading…", …) for every
 * managed catalog model whose weights are not usable locally. Returns an empty
 * map in attach mode or on probe failure so the picker degrades to its
 * un-annotated default instead of hiding state.
 */
export async function fetchAxEngineModelAnnotations(sdk: ReturnType<typeof useSDK>): Promise<Map<string, string>> {
  const catalog = await fetchAxEngineCatalog(sdk).catch(() => undefined)
  return axEngineModelStateAnnotations(catalog?.models ?? [])
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
  const catalog = await fetchAxEngineCatalog(sdk)
  const entry = catalog?.models?.find((model) => model.id === modelID)
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
 * model whose weights are missing. Only the managed-download path applies the
 * selection: it becomes usable automatically when the download completes.
 * Choosing to download manually keeps the current model — selecting weights
 * that nothing will fetch would make the next message fail with
 * MODEL_NOT_PREPARED.
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
            // Apply the selection only once the download job is actually
            // running — a failed start must not leave an unusable model active.
            return startAxEngineDownload(props.sdk, props.offer).then(
              () => {
                props.onApplySelection()
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
            props.toast.show({
              variant: "info",
              message: `Selection unchanged — run: ax-engine download ${props.offer.hfRepo}`,
            })
          },
        },
      ]}
    />
  )
}
