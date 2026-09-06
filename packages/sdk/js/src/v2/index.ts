/**
 * All-in-one v2 entry point: spawn (or attach to) a local AX Code server and
 * get a matching typed client in one call via `createAxCode`. Re-exports
 * everything from `./client.js` and `./server.js`.
 *
 * @example
 * ```ts
 * import { createAxCode } from "@defai-digital/ax-code-sdk/v2"
 *
 * const { client, server } = await createAxCode({ directory: "." })
 * ```
 *
 * @module
 */

export * from "./client.js"
export * from "./server.js"

import { createAxCodeClient } from "./client.js"
import { createAxCodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

/**
 * Spawn a local AX Code server and return it together with a typed client
 * pointed at it (auth headers pre-wired). Dispose of `server` when done.
 */
export async function createAxCode(options?: ServerOptions) {
  const server = await createAxCodeServer({
    ...options,
  })

  const client = createAxCodeClient({
    baseUrl: server.url,
    headers: server.headers,
  })

  return {
    client,
    server,
  }
}

/** Legacy alias for {@link createAxCode}. */
export const createOpencode = createAxCode
