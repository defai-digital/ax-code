import { createAxCodeClient } from "@ax-code/sdk/v2"
import { Flag } from "@/flag/flag"
import { Server } from "@/server/server"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import { ServerRuntimeAuth } from "@/server/runtime-auth"

export namespace RuntimeLocalClient {
  export function url() {
    return Server.url ?? new URL(`http://localhost:${DEFAULT_SERVER_PORT}`)
  }

  export function create(input: { directory: string }) {
    const localFetch = (async (request: Request) => {
      ServerRuntimeAuth.apply(request.headers)
      return Server.Default().fetch(request)
    }) as typeof fetch

    return createAxCodeClient({
      baseUrl: `http://localhost:${DEFAULT_SERVER_PORT}`,
      directory: input.directory,
      headers: Flag.AX_CODE_SERVER_PASSWORD
        ? {
            Authorization: `Basic ${Buffer.from(`${Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"}:${Flag.AX_CODE_SERVER_PASSWORD}`).toString("base64")}`,
          }
        : undefined,
      fetch: localFetch,
    })
  }
}
