export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { assertLocalAxCodeBaseUrl, withDirectoryHeaders, createNoTimeoutFetch } from "./protocol.js"
export { type Config as OpencodeClientConfig, OpencodeClient }
export { type Config as AxCodeClientConfig, OpencodeClient as AxCodeClient }

export function createAxCodeClient(input?: Config & { directory?: string }) {
  // Always spread into a new object to avoid mutating the caller's config.
  let config: Config & { directory?: string } = { ...input }
  if (config.baseUrl) assertLocalAxCodeBaseUrl(config.baseUrl)

  if (!config.fetch) {
    config = { ...config, fetch: createNoTimeoutFetch() }
  }

  if (config.directory) {
    config = {
      ...config,
      headers: withDirectoryHeaders(config.headers as Record<string, string> | undefined, config.directory),
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}

export const createOpencodeClient = createAxCodeClient
