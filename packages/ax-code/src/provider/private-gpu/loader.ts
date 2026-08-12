import { Auth } from "@/auth"
import { Env } from "@/env"
import type { Provider } from "../provider"
import type { CustomLoader } from "../loaders"
import {
  DEDICATED_PRIVATE_GPU_VENDORS,
  PRIVATE_GPU_REQUEST_TIMEOUT_MS,
  type PrivateGpuVendor,
} from "./presets"
import { discoverPrivateGpuModels, privateGpuModelRecords } from "./discover"
import { normalizeVendorBaseURL } from "./endpoint"

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function resolveBaseURL(vendor: PrivateGpuVendor, provider: Provider.Info) {
  const configured = optionalString(provider.options?.baseURL)
  const fromEnv = vendor.envBaseURL ? optionalString(Env.get(vendor.envBaseURL)) : undefined
  const raw = configured || fromEnv || vendor.defaultApi
  if (!raw) return undefined
  try {
    return normalizeVendorBaseURL(raw, vendor)
  } catch {
    return undefined
  }
}

async function resolveApiKey(vendor: PrivateGpuVendor) {
  const auth = await Auth.get(vendor.id)
  if (auth?.type === "api" && auth.key.trim()) return auth.key.trim()
  return optionalString(Env.get(vendor.envKey))
}

export function privateGpuLoader(vendor: PrivateGpuVendor): CustomLoader {
  return async (provider) => {
    const baseURL = resolveBaseURL(vendor, provider)
    const apiKey = await resolveApiKey(vendor)
    const ready = Boolean(baseURL && apiKey)

    return {
      autoload: ready,
      options: {
        ...(baseURL ? { baseURL } : {}),
        timeout: PRIVATE_GPU_REQUEST_TIMEOUT_MS,
      },
      async discoverModels(current) {
        const endpoint = resolveBaseURL(vendor, current) ?? baseURL
        const token = (await resolveApiKey(vendor)) ?? apiKey
        if (!endpoint || !token) return {}
        try {
          const discovered = await discoverPrivateGpuModels({
            vendor,
            baseURL: endpoint,
            apiKey: token,
          })
          return privateGpuModelRecords(discovered.models, discovered.baseURL, vendor)
        } catch {
          return {}
        }
      },
    }
  }
}

export const PRIVATE_GPU_LOADERS: Record<string, CustomLoader> = Object.fromEntries(
  DEDICATED_PRIVATE_GPU_VENDORS.map((vendor) => [vendor.id, privateGpuLoader(vendor)]),
)
