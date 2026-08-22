import { isPositive } from "@perf/core"

export function validateToken(token: string): boolean {
  return token.length > 0 && isPositive(token.length)
}
