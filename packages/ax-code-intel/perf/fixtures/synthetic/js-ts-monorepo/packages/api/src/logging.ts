import { formatList } from "@perf/core"

export function logRequest(parts: string[]): string {
  return formatList(parts)
}
