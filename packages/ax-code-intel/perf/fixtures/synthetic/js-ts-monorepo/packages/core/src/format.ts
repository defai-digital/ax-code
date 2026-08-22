import type { Point } from "./geom"

export function formatPoint(p: Point): string {
  return `(${p.x}, ${p.y})`
}

export function formatList(items: string[]): string {
  return items.join(", ")
}
