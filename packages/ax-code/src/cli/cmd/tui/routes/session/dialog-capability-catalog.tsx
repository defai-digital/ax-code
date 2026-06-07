import { createMemo, createResource, onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { createAbortableResourceFetcher } from "../../util/abortable-resource"
import { capabilityCatalogOptions, type CapabilityCatalogItem } from "./capability-catalog"

type CapabilityClient = {
  capability?: {
    list: (
      parameters?: { directory?: string },
      options?: { signal?: AbortSignal },
    ) => Promise<{ data?: CapabilityCatalogItem[] }>
  }
}

async function loadCapabilityCatalog(sdk: ReturnType<typeof useSDK>, signal: AbortSignal) {
  const client = sdk.client as typeof sdk.client & CapabilityClient
  if (client.capability) {
    const result = await client.capability.list(undefined, { signal })
    return result.data ?? []
  }

  const url = new URL("/capability", sdk.url)
  if (sdk.directory) url.searchParams.set("directory", sdk.directory)
  const response = await sdk.fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to load capability catalog: ${response.status}`)
  return (await response.json()) as CapabilityCatalogItem[]
}

export function DialogCapabilityCatalog() {
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [capabilities] = createResource(
    createAbortableResourceFetcher(async (_ready: true, signal) => {
      return loadCapabilityCatalog(sdk, signal)
    }),
  )

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    capabilityCatalogOptions(capabilities() ?? []).map((option) => ({
      ...option,
      onSelect: () => undefined,
    })),
  )

  return <DialogSelect title="Capability Catalog" placeholder="Search capabilities..." options={options()} />
}
