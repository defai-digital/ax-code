import { Auth } from "../auth"
import { Config } from "../config/config"
import { Env } from "../env"
import { iife } from "@/util/iife"
import type { Provider } from "./provider"

export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
export type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
export type CustomDiscoverModels = () => Promise<Record<string, Provider.Model>>
export type CustomLoader = (provider: Provider.Info) => Promise<{
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: Record<string, any>
  discoverModels?: CustomDiscoverModels
}>

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  "ax-code": async (input) => {
    const hasKey = await (async () => {
      const env = Env.all()
      if (input.env.some((item) => env[item])) return true
      if (await Auth.get(input.id)) return true
      const config = await Config.get()
      if (config.provider?.["ax-code"]?.options?.apiKey) return true
      return false
    })()

    if (!hasKey) {
      for (const [key, value] of Object.entries(input.models)) {
        if (value.cost.input === 0) continue
        delete input.models[key]
      }
    }

    return {
      autoload: Object.keys(input.models).length > 0,
      options: hasKey ? {} : { apiKey: "public" },
    }
  },
  xai: async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        return sdk.responses(modelID)
      },
      options: {},
    }
  },
  "sap-ai-core": async () => {
    const auth = await Auth.get("sap-ai-core")
    // TODO: Using process.env directly because Env.set only updates a shallow copy (not process.env),
    // until the scope of the Env API is clarified (test only or runtime?)
    const envServiceKey = iife(() => {
      const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY
      if (envAICoreServiceKey) return envAICoreServiceKey
      if (auth?.type === "api") {
        process.env.AICORE_SERVICE_KEY = auth.key
        return auth.key
      }
      return undefined
    })
    const deploymentId = process.env.AICORE_DEPLOYMENT_ID
    const resourceGroup = process.env.AICORE_RESOURCE_GROUP

    return {
      autoload: !!envServiceKey,
      options: envServiceKey ? { deploymentId, resourceGroup } : {},
      async getModel(sdk: any, modelID: string) {
        return sdk(modelID)
      },
    }
  },
  zenmux: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://ax-code.ai/",
          "X-Title": "ax-code",
        },
      },
    }
  },
  "cloudflare-workers-ai": async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    if (!accountId) return { autoload: false }

    const apiKey = await iife(async () => {
      const envToken = Env.get("CLOUDFLARE_API_KEY")
      if (envToken) return envToken
      const auth = await Auth.get(input.id)
      if (auth?.type === "api") return auth.key
      return undefined
    })

    return {
      autoload: !!apiKey,
      options: {
        apiKey,
      },
      async getModel(sdk: any, modelID: string) {
        return sdk.languageModel(modelID)
      },
      vars(_options) {
        return {
          CLOUDFLARE_ACCOUNT_ID: accountId,
        }
      },
    }
  },
  "cloudflare-ai-gateway": async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

    if (!accountId || !gateway) return { autoload: false }

    // Get API token from env or auth - required for authenticated gateways
    const apiToken = await (async () => {
      const envToken = Env.get("CLOUDFLARE_API_TOKEN") || Env.get("CF_AIG_TOKEN")
      if (envToken) return envToken
      const auth = await Auth.get(input.id)
      if (auth?.type === "api") return auth.key
      return undefined
    })()

    if (!apiToken) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
          "Set it via environment variable or run `ax-code auth cloudflare-ai-gateway`.",
      )
    }

    // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
    const { createAiGateway } = await import("ai-gateway-provider")
    const { createUnified } = await import("ai-gateway-provider/providers/unified")

    const metadata = iife(() => {
      if (input.options?.metadata) return input.options.metadata
      try {
        return JSON.parse(input.options?.headers?.["cf-aig-metadata"])
      } catch {
        return undefined
      }
    })
    const opts = {
      metadata,
      cacheTtl: input.options?.cacheTtl,
      cacheKey: input.options?.cacheKey,
      skipCache: input.options?.skipCache,
      collectLog: input.options?.collectLog,
    }

    const aigateway = createAiGateway({
      accountId,
      gateway,
      apiKey: apiToken,
      ...(Object.values(opts).some((v) => v !== undefined) ? { options: opts } : {}),
    })
    const unified = createUnified()

    return {
      autoload: true,
      async getModel(_sdk: any, modelID: string, _options?: Record<string, any>) {
        // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
        return aigateway(unified(modelID))
      },
      options: {},
    }
  },
  kilo: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://ax-code.ai/",
          "X-Title": "ax-code",
        },
      },
    }
  },
}
