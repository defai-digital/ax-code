import { createOpencodeClient } from "@ax-code/sdk/v2"
import { Flag } from "@/flag/flag"
import { Server } from "@/server/server"
import { ServerRuntimeAuth } from "@/server/runtime-auth"

export namespace RuntimeLocalClient {
  export function url() {
    return Server.url ?? new URL("http://localhost:4096")
  }

  export function create(input: { directory: string }) {
    const localFetch = (async (request: Request) => {
      ServerRuntimeAuth.apply(request.headers)
      return Server.Default().fetch(request)
    }) as typeof fetch

    return createOpencodeClient({
      baseUrl: "http://localhost:4096",
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
