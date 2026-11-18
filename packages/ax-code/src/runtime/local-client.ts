import { createAxCodeClient, type AxCodeClient } from "@ax-code/sdk/v2/client"
import { DEFAULT_SERVER_PORT } from "@/constants/server"
import { Flag } from "@/flag/flag"
import { Server } from "@/server/server"
import { ServerRuntimeAuth } from "@/server/runtime-auth"

export namespace RuntimeLocalClient {
  export function url(): URL {
    return Server.currentUrl()
  }

  export function create(input: { directory: string; baseUrl?: string }): AxCodeClient {
    const localFetch = (async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(requestInput, init)
      ServerRuntimeAuth.apply(request.headers)
      return Server.Default().fetch(request)
    }) as typeof fetch

    return createAxCodeClient({
      baseUrl: input.baseUrl ?? `http://localhost:${DEFAULT_SERVER_PORT}`,
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
