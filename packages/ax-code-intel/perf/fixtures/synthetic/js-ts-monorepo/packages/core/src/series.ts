import { add } from "./math"

export function sumTo(n: number): number {
  let total = 0
  for (let i = 1; i <= n; i++) total = add(total, i)
  return total
}

export function fibonacci(n: number): number {
  let a = 0
  let b = 1
  for (let i = 0; i < n; i++) [a, b] = [b, a + b]
  return a
}
