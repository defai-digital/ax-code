import { Log } from "../util/log"
import type { LSPClient } from "./client"

const log = Log.create({ service: "lsp" })

type NotifyClient = Pick<LSPClient.Info, "notify" | "serverID">

export async function openAll(
  clients: NotifyClient[],
  input: { path: string; waitForDiagnostics?: boolean },
): Promise<{ count: number; ok: boolean }> {
  const results = await Promise.allSettled(
    clients.map((client) => client.notify.open({ path: input.path, waitForDiagnostics: input.waitForDiagnostics })),
  )
  let count = 0
  let ok = true
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === "rejected") {
      ok = false
      log.error("failed to touch file for client", {
        err: result.reason,
        file: input.path,
        serverID: clients[i]?.serverID,
      })
      continue
    }
    count++
  }
  return { count, ok }
}

export async function closeAll(clients: NotifyClient[], input: { path: string; deleted?: boolean }): Promise<void> {
  const results = await Promise.allSettled(
    clients.map((client) => client.notify.close({ path: input.path, deleted: input.deleted })),
  )
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === "rejected") {
      log.error("failed to close file for client", {
        err: result.reason,
        file: input.path,
        serverID: clients[i]?.serverID,
      })
    }
  }
}
