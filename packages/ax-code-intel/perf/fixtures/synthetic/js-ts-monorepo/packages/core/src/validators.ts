import { add } from "./math"

export function isPositive(n: number): boolean {
  return n > 0
}

export function isEven(n: number): boolean {
  return add(n, 0) % 2 === 0
}
