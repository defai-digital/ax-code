export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { withDirectoryHeaders } from "./protocol.js"
export { type Config as OpencodeClientConfig, OpencodeClient }
export { type Config as AxCodeClientConfig, OpencodeClient as AxCodeClient }

export function createAxCodeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    // Bun extends Request with a `timeout` property (false = no per-request
    // timeout). Disable it so SSE connections and long agent sessions are not
    // killed by Bun's default connection timeout.
    const noTimeoutFetch = ((input: URL | RequestInfo, init?: RequestInit) => {
      if (input instanceof Request) {
        ;(input as Request & { timeout?: boolean }).timeout = false
      }
      return fetch(input, init)
    }) as typeof fetch
    config = {
      ...config,
      fetch: noTimeoutFetch,
    }
  }

  if (config?.directory) {
    config.headers = withDirectoryHeaders(config.headers as Record<string, string> | undefined, config.directory)
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}

export const createOpencodeClient = createAxCodeClient
