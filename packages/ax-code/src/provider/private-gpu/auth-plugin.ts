import type { Hooks, Plugin } from "@ax-code/plugin"
import { Log } from "@/util/log"
import { DEDICATED_PRIVATE_GPU_VENDORS, type PrivateGpuVendor } from "./presets"
import { connectPrivateGpu } from "./connect"

export function privateGpuAuthPlugin(vendor: PrivateGpuVendor): Plugin {
  const log = Log.create({ service: `${vendor.id}.auth` })

  const hooks: Hooks = {
    auth: {
      provider: vendor.id,
      methods: [
        {
          type: "api",
          label: `${vendor.name} endpoint + token`,
          prompts: [
            {
              type: "text",
              key: "baseURL",
              message: `${vendor.name} endpoint URL`,
              placeholder: vendor.urlPlaceholder,
              validate: (value) => (value.trim() ? undefined : "Endpoint URL is required"),
            },
            {
              type: "text",
              key: "apiKey",
              message: `${vendor.name} ${vendor.tokenLabel.toLowerCase()}`,
              placeholder: vendor.tokenPlaceholder,
              validate: (value) => (value.trim() ? undefined : `${vendor.tokenLabel} is required`),
            },
          ],
          async authorize(inputs) {
            const baseURL = inputs?.baseURL?.trim() ?? ""
            const apiKey = inputs?.apiKey?.trim() ?? ""
            if (!baseURL || !apiKey) return { type: "failed" as const }
            try {
              await connectPrivateGpu({ providerID: vendor.id, baseURL, apiKey })
              return { type: "success" as const, key: apiKey }
            } catch (error) {
              log.warn(`${vendor.name} connect failed`, { error })
              return { type: "failed" as const }
            }
          },
        },
      ],
    },
  }

  return Object.defineProperty(async () => hooks, "name", {
    value: `${vendor.id}-auth`,
  }) as Plugin
}

export const PRIVATE_GPU_AUTH_PLUGINS = DEDICATED_PRIVATE_GPU_VENDORS.map(privateGpuAuthPlugin)

export const PRIVATE_GPU_AUTH_PLUGIN_BY_ID = Object.fromEntries(
  DEDICATED_PRIVATE_GPU_VENDORS.map((vendor, index) => [vendor.id, PRIVATE_GPU_AUTH_PLUGINS[index]]),
)
