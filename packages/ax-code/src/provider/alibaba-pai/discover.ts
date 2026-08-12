import { discoverPrivateGpuModels, privateGpuModelRecords, type PrivateGpuDiscoveredModel } from "../private-gpu/discover"
import { requirePrivateGpuVendor } from "../private-gpu/presets"
import type { Provider } from "../provider"
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
  return Object.fromEntries(
    Object.entries(records).map(([id, model]) => [id, { ...model, providerID: model.providerID }]),
  )
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
