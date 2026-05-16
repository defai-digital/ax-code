import type { Adaptor } from "./types"

const items = new Map<string, Adaptor>()

export function installAdaptor(type: string, adaptor: Adaptor) {
  items.set(type, adaptor)
}

export function getAdaptor(type: string) {
  return items.get(type)
}

export function removeAdaptor(type: string) {
  return items.delete(type)
}
