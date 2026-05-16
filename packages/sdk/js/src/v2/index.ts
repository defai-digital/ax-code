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
