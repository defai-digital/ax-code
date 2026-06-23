import type { MiddlewareHandler } from "hono"
import { getConnInfo } from "@hono/node-server/conninfo"
import { Log } from "@/util/log"
import { rateLimited } from "./error"

const RATE_SWEEP_INTERVAL_MS = 30_000

export function resolveRateLimitClientIP(input: {
  context: Parameters<MiddlewareHandler>[0]
  log: Log.Logger
  warnOnce: () => boolean
}) {
  try {
    const nodeAddress = getConnInfo(input.context).remote.address
    if (typeof nodeAddress === "string" && nodeAddress.length > 0) return nodeAddress
  } catch (error) {
    if (input.warnOnce()) {
      input.log.warn("failed to resolve client IP for rate limiting", { error })
    }
  }
  return undefined
}

export function createRateLimitMiddleware(log: Log.Logger): MiddlewareHandler {
  const rate = new Map<string, { count: number; reset: number }>()
  let lastRateSweepAt = 0
  let warnedRequestIpFailure = false

  return async (c, next) => {
    // Prefer the socket's remote address (not spoofable) over headers.
    const socketAddr = resolveRateLimitClientIP({
      context: c,
      log,
      warnOnce: () => {
        if (warnedRequestIpFailure) return false
        warnedRequestIpFailure = true
        return true
      },
    })
    const ip = socketAddr ?? `unknown:${crypto.randomUUID()}`
    const key = `${ip}:${c.req.method}:${c.req.path.startsWith("/session/") ? "/session" : c.req.path}`
    const now = Date.now()
    // Periodically evict expired buckets so stale keys do not accumulate
    // indefinitely on low-cardinality traffic patterns.
    if (rate.size > 5_000 || now - lastRateSweepAt >= RATE_SWEEP_INTERVAL_MS) {
      lastRateSweepAt = now
      for (const [k, v] of rate) {
        if (v.reset <= now) rate.delete(k)
      }
    }
    const current = rate.get(key)
    const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)
    const isFastAcceptRoute =
      c.req.path.includes("/prompt_async") ||
      c.req.path.includes("/command_async") ||
      c.req.path.includes("/shell_async") ||
      c.req.path.endsWith("/shell")
    const limit = isFastAcceptRoute ? 30 : mutating ? 120 : 600
    if (!current || current.reset <= now) {
      rate.set(key, { count: 1, reset: now + 60_000 })
      return next()
    }
    if (current.count >= limit) {
      return rateLimited(c)
    }
    current.count++
    return next()
  }
}

export function createRequestLoggingMiddleware(log: Log.Logger): MiddlewareHandler {
  return async (c, next) => {
    const skipLogging = c.req.path === "/log"
    if (!skipLogging) {
      log.info("request", {
        method: c.req.method,
        path: c.req.path,
      })
    }
    const timer = log.time("request", {
      method: c.req.method,
      path: c.req.path,
    })
    await next()
    if (!skipLogging) {
      timer.stop()
    }
  }
}
