import type { Part } from "@ax-code/sdk/v2/client"

export const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function sortPartsById(parts: Part[], skipPartTypes?: ReadonlySet<string>) {
  return parts
    .filter((part) => !!part?.id && !skipPartTypes?.has(part.type))
    .sort((a, b) => compareIds(a.id, b.id))
}
