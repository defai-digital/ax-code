/**
 * HTTP-server-based ax-code client.
 *
 * This was the default export in @ax-code/sdk@1.4.0. In 2.0.0 it
 * moved to `@ax-code/sdk/http` — the new default is the in-process
 * `createAgent` from `@ax-code/sdk`.
 *
 * @example
 * ```ts
 * import { createAxCode } from "@ax-code/sdk/http"
 *
 * const { client, server } = await createAxCode()
 * const sessions = await client.session.list()
 * ```
 */

export * from "./client.js"
export * from "./server.js"

import { createAxCodeClient } from "./client.js"
import { createAxCodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createAxCode(options?: ServerOptions) {
  const server = await createAxCodeServer({
    ...options,
  })

  const client = createAxCodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

export const createOpencode = createAxCode
