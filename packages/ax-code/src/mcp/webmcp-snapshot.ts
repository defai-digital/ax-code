import { isRecord } from "@/util/record"

export type SnapshotNode = {
  uid: string
  role: string
  name: string
  description?: string
  focused: boolean
  attributes: Record<string, string | number | boolean>
}

const MAX_SNAPSHOT_NODES = 5000
/**
 * Walk bound for the whole tree: records visited, the work stack and any
 * single children array. The 32 KiB read budget caps text parts, never
 * structuredContent, so a wide or deep hostile snapshot must fail closed
 * before it grows the stack or holds the event loop.
 */
export const MAX_SNAPSHOT_VISITS = 50_000
const MAX_NODE_TEXT = 512

/** Bound text shared by structured snapshot nodes and their dialog metadata. */
export function nodeText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_NODE_TEXT) : ""
}

/**
 * Parse the bridge's structured snapshot (`structuredContent.snapshot`, a
 * JSON tree with id/role/name/attributes/children) into a uid map. Returns
 * undefined when the result carries no structured snapshot; a malformed or
 * oversized tree yields undefined too, so the caller clears the baseline
 * instead of binding against a partial map.
 */
export function parseStructuredSnapshot(result: unknown): Map<string, SnapshotNode> | undefined {
  const record = isRecord(result) ? result : {}
  const structured = isRecord(record.structuredContent) ? record.structuredContent : undefined
  if (!structured || !isRecord(structured.snapshot)) return undefined
  const nodes = new Map<string, SnapshotNode>()
  const stack: unknown[] = [structured.snapshot]
  let visited = 0
  while (stack.length > 0) {
    const raw = stack.pop()
    if (!isRecord(raw)) continue
    if (++visited > MAX_SNAPSHOT_VISITS || nodes.size >= MAX_SNAPSHOT_NODES) return undefined
    const id = raw.id
    if (typeof id === "string" && id.length > 0 && id.length <= 128 && !nodes.has(id)) {
      const attributes: Record<string, string | number | boolean> = {}
      for (const [key, value] of Object.entries(raw)) {
        if (key === "id" || key === "role" || key === "name" || key === "description" || key === "children") continue
        if (typeof value === "boolean" || typeof value === "number") attributes[key] = value
        else if (typeof value === "string") attributes[key] = value.slice(0, MAX_NODE_TEXT)
      }
      nodes.set(id, {
        uid: id,
        role: nodeText(raw.role),
        name: nodeText(raw.name),
        description: typeof raw.description === "string" ? nodeText(raw.description) : undefined,
        focused: raw.focused === true,
        attributes,
      })
    }
    if (Array.isArray(raw.children)) {
      if (raw.children.length > MAX_SNAPSHOT_VISITS) return undefined
      for (const child of raw.children) stack.push(child)
      if (stack.length > MAX_SNAPSHOT_VISITS) return undefined
    }
  }
  // A tree with no usable ids binds nothing: return undefined like the
  // malformed/oversized paths so the caller clears the baseline instead of
  // recording a URL with an empty uid map.
  return nodes.size > 0 ? nodes : undefined
}
