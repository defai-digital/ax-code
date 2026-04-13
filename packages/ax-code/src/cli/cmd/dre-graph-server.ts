import { Server } from "../../server/server"

type Live = Awaited<ReturnType<typeof Server.listen>>

let shared: Promise<Live> | undefined

export namespace DreGraphServer {
  export function clear() {
    shared = undefined
  }

  export function listen(port = 0) {
    return Server.listen({
      hostname: "127.0.0.1",
      port,
      mdns: false,
      cors: [],
    })
  }

  export function local(base?: string) {
    if (!base || base === "http://opencode.internal") return
    const url = new URL(base)
    if (url.hostname !== "127.0.0.1") return
    return url
  }

  export async function ensure() {
    if (shared) return shared
    const next = Promise.resolve(listen(0))
    shared = next.catch((err) => {
      if (shared === next) shared = undefined
      throw err
    })
    return shared
  }

  export async function page(input: {
    base?: string
    sessionID?: string
    directory?: string
    index?: boolean
  }) {
    const root = local(input.base) ?? new URL(`http://127.0.0.1:${(await ensure()).port}`)
    const url = new URL(input.index ? "/dre-graph" : `/dre-graph/session/${input.sessionID}`, root.toString())
    url.hostname = "127.0.0.1"
    url.search = ""
    if (input.directory) url.searchParams.set("directory", input.directory)
    return url
  }
}
