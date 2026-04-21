import { Binary } from "@ax-code/util/binary"

export function findByID<T extends { id: string }>(items: T[], id: string): T | undefined {
  const match = Binary.search(items, id, (item) => item.id)
  if (!match.found) return
  return items[match.index]
}

export function sessionRuntimeStatus<
  TSession extends { time?: { compacting?: unknown } | undefined },
  TMessage extends { role?: string; time?: object | undefined },
>(session: TSession | undefined, messages: TMessage[]): "idle" | "working" | "compacting" {
  if (!session) return "idle"
  if (session.time?.compacting) return "compacting"
  const last = messages.at(-1)
  if (!last) return "idle"
  if (last.role === "user") return "working"
  const completed =
    last.time && "completed" in last.time ? (last.time as { completed?: unknown }).completed : undefined
  return completed ? "idle" : "working"
}

export function findWorkspace(workspaces: string[], workspaceID: string) {
  return workspaces.find((workspace) => workspace === workspaceID)
}
