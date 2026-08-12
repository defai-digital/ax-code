import { normalizeVendorBaseURL, privateGpuModelsURL } from "../private-gpu/endpoint"
import { requirePrivateGpuVendor } from "../private-gpu/presets"

const vendor = requirePrivateGpuVendor("alibaba-pai")

export function normalizeAlibabaPaiBaseURL(input: string) {
  return normalizeVendorBaseURL(input, vendor)
}

export function alibabaPaiModelsURL(baseURL: string) {
  return privateGpuModelsURL(baseURL, vendor)
}
