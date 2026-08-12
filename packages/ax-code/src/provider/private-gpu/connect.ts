import { Auth } from "@/auth"
import { Config } from "@/config/config"
import {
  PRIVATE_GPU_REQUEST_TIMEOUT_MS,
  type PrivateGpuVendor,
  requireDedicatedPrivateGpuVendor,
  isDedicatedPrivateGpuProviderID,
} from "./presets"
import { discoverPrivateGpuModels } from "./discover"
import { normalizeVendorBaseURL } from "./endpoint"

export type PrivateGpuConnection = {
  providerID: string
  baseURL: string
  models: string[]
}

export function privateGpuProviderConfig(vendor: PrivateGpuVendor, baseURL: string) {
  return {
    [vendor.id]: {
      name: vendor.name,
      npm: vendor.npm,
      env: [vendor.envKey],
      options: {
        baseURL: normalizeVendorBaseURL(baseURL, vendor),
        timeout: PRIVATE_GPU_REQUEST_TIMEOUT_MS,
      },
    },
  }
}

export async function connectPrivateGpu(input: {
  providerID: string
  baseURL: string
  apiKey: string
}): Promise<PrivateGpuConnection> {
  const vendor = requireDedicatedPrivateGpuVendor(input.providerID)
  const discovered = await discoverPrivateGpuModels({
    vendor,
    baseURL: input.baseURL,
    apiKey: input.apiKey,
  })
  await Auth.set(vendor.id, {
    type: "api",
    key: input.apiKey.trim(),
  })
  try {
    await Config.updateGlobal({
      provider: privateGpuProviderConfig(vendor, discovered.baseURL),
    })
  } catch (error) {
    await Auth.remove(vendor.id).catch(() => undefined)
    throw error
  }
  return {
    providerID: vendor.id,
    baseURL: discovered.baseURL,
    models: discovered.models.map((model) => model.id),
  }
}

export async function removePrivateGpuProviderConfig(providerID: string) {
  if (!isDedicatedPrivateGpuProviderID(providerID)) return
  const global = await Config.getGlobal()
  if (!global.provider?.[providerID]) return
  await Config.updateGlobal({
    provider: {
      [providerID]: undefined,
    },
  } as unknown as Config.Info)
}

export async function disconnectPrivateGpu(providerID: string) {
  await Auth.remove(providerID)
  await removePrivateGpuProviderConfig(providerID)
}
