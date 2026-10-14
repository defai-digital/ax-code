import {
  discoverPrivateGpuModels,
  privateGpuModelRecords,
  type PrivateGpuDiscoveredModel,
} from "../private-gpu/discover"
import { requirePrivateGpuVendor } from "../private-gpu/presets"
import type { Provider } from "../provider"
import { ProviderID } from "../schema"
import { ALIBABA_PAI_PROVIDER_ID } from "./constants"

const vendor = requirePrivateGpuVendor(ALIBABA_PAI_PROVIDER_ID)

export type AlibabaPaiDiscoveredModel = PrivateGpuDiscoveredModel

export function alibabaPaiModelRecords(
  models: AlibabaPaiDiscoveredModel[],
  baseURL: string,
  providerID = ALIBABA_PAI_PROVIDER_ID,
): Record<string, Provider.Model> {
  const records = privateGpuModelRecords(models, baseURL, vendor)
  if (providerID === ALIBABA_PAI_PROVIDER_ID) return records
  // Re-key to the requested provider. `model.providerID` is always the vendor
  // id, so spreading it left the records labelled alibaba-pai and ignored the
  // argument.
  const relabeled = ProviderID.make(providerID)
  return Object.fromEntries(Object.entries(records).map(([id, model]) => [id, { ...model, providerID: relabeled }]))
}

export async function discoverAlibabaPaiModels(input: {
  baseURL: string
  apiKey: string
  timeoutMs?: number
  fetcher?: typeof fetch
}) {
  return discoverPrivateGpuModels({
    vendor,
    baseURL: input.baseURL,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
  })
}
