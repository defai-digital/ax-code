import { randomBytes, timingSafeEqual } from "node:crypto"
import type { Context } from "hono"

export namespace ServerRuntimeAuth {
  export const HEADER = "x-ax-code-runtime-token"
  const token = randomBytes(32).toString("base64url")

  export function headers(): Record<string, string> {
    return { [HEADER]: token }
  }

  export function apply(headers: Headers) {
    if (!headers.has(HEADER)) headers.set(HEADER, token)
  }

  export function isAuthorized(value: string | undefined): boolean {
    if (!value) return false
    const expected = Buffer.from(token)
    const actual = Buffer.from(value)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  export function require(c: Context) {
    if (isAuthorized(c.req.header(HEADER))) return undefined
    return c.json({ error: "runtime authorization required" }, 403)
  }
}
