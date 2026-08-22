import { add, mul } from "./math"

export interface Point {
  x: number
  y: number
}

export function distance(a: Point, b: Point): number {
  const dx = add(a.x, -b.x)
  const dy = add(a.y, -b.y)
  return Math.sqrt(add(mul(dx, dx), mul(dy, dy)))
}
