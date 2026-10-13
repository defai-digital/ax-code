import z from "zod"
import { parseNativeJson } from "../util/native-json"
import { CodeNodeID } from "./id"
import type { ProjectID } from "../project/schema"
import { CODE_NODE_KINDS } from "./schema.sql"

export const CALL_NEIGHBOR_LIMIT = 50_000
export const CALL_NEIGHBOR_BYTES = 16 * 1024 * 1024
const position = z.number().int().safe()
const row = z.object({
  id: z.string().transform(CodeNodeID.make),
  project_id: z.string().transform((id) => id as ProjectID),
  kind: z.enum(CODE_NODE_KINDS),
  name: z.string(),
  qualified_name: z.string(),
  file: z.string(),
  range_start_line: position,
  range_start_char: position,
  range_end_line: position,
  range_end_char: position,
  signature: z.string().nullable(),
  visibility: z.string().nullable(),
  indexed_at: position.nullable(),
  completeness: z.string().nullable(),
})
export type CallNeighborRow = z.infer<typeof row>
export type SymbolRow = Omit<CallNeighborRow, "indexed_at" | "completeness">

export function admitCallQuery(project: string, symbol: string) {
  if (Buffer.byteLength(project) + Buffer.byteLength(symbol) > 16 * 1024)
    throw new Error("Graph query input limit exceeded")
}
export function decodeCallNeighbors(json: string, project: ProjectID): CallNeighborRow[] {
  if (Buffer.byteLength(json) > CALL_NEIGHBOR_BYTES) throw new Error("Graph query output limit exceeded")
  const result = parseNativeJson(json, z.array(row).max(CALL_NEIGHBOR_LIMIT), "Invalid native graph neighbors")
  if (result.some((entry) => entry.project_id !== project))
    throw new Error("Native graph query crossed project boundary")
  return result
}
