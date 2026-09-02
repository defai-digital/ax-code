/**
 * HTTP-server-based ax-code client.
 *
 * This was the default export in the private workspace package
 * `@ax-code/sdk@1.4.0`. It moved to the internal `@ax-code/sdk/http` path in
 * 2.0.0. The public JSR package does not export this legacy surface; app
 * integrations use its headless or gRPC entry point.
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
    headers: server.headers,
  })

  return {
    client,
    server,
  }
}
