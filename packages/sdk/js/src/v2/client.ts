/**
 * Generated v2 HTTP client for the AX Code local server.
 *
 * `createAxCodeClient` wraps the generated operations in a single typed
 * `AxCodeClient`. The base URL must be a local loopback address unless
 * explicitly overridden; `directory` / `experimental_workspaceID` are sent as
 * scoping headers on every request. All generated API types are re-exported
 * from this module.
 *
 * @example
 * ```ts
 * import { createAxCodeClient } from "@defai-digital/ax-code-sdk/v2/client"
 *
 * const client = createAxCodeClient({ baseUrl: "http://localhost:4096" })
 * ```
 *
 * @module
 */

export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import {
  assertLocalAxCodeBaseUrl,
  withDirectoryHeaders,
  withWorkspaceHeaders,
  createNoTimeoutFetch,
} from "../protocol.js"
import { AxCodeClient } from "./gen/sdk.gen.js"
export { type Config as AxCodeClientConfig, AxCodeClient }

/**
 * Create a typed HTTP client for a running AX Code server. The base URL must
 * be a loopback address unless explicitly overridden. A custom `fetch` with no
 * timeout is installed by default; `directory` /
 * `experimental_workspaceID` become scoping headers on every request.
 */
export function createAxCodeClient(input?: Config & { directory?: string; experimental_workspaceID?: string }) {
  // Always spread into a new object to avoid mutating the caller's config.
  let config: Config & { directory?: string; experimental_workspaceID?: string } = { ...input }
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

  if (config.experimental_workspaceID) {
    config = {
      ...config,
      headers: withWorkspaceHeaders(
        config.headers as Record<string, string> | undefined,
        config.experimental_workspaceID,
      ),
    }
  }

  const client = createClient(config)
  return new AxCodeClient({ client })
}
