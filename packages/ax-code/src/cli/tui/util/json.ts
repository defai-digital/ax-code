import { parseJsonPayload } from "@/util/json-value"

export function parseTuiJsonPayload(raw: string | undefined): unknown | undefined {
  return parseJsonPayload(raw)
}
