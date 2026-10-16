import { Log } from "../util/log"
import { NamedError } from "@ax-code/util/error"
import { z } from "zod"
import type { Client } from "@modelcontextprotocol/client"
import { withTimeout } from "@/util/timeout"

const log = Log.create({ service: "mcp-health" })

export namespace SessionHealth {
  /** ADR-237: probe servers that have been idle for longer than this. */
  export const MCP_IDLE_THRESHOLD_MS = 5 * 60_000

  /** ADR-237: hard cap on the idle ping so a dead server fails the call fast. */
  export const MCP_IDLE_PING_TIMEOUT_MS = 2_000

  /**
   * Thrown when a tracked call is still in flight while the underlying
   * transport closes (ADR-237: "fail in-flight calls immediately"). The
   * `callTool` wrapper propagates this to the dynamic-tool caller as a
   * regular error so the SDK does not sit on the full MCP timeout.
   */
  export const TransportClosed = NamedError.create(
    "MCPTransportClosed",
    z.object({
      server: z.string(),
    }),
  )
  export type TransportClosed = z.infer<typeof TransportClosed>

  /**
   * Last-activity timestamp per client, in ms since the epoch. A WeakMap
   * follows the client's lifetime so disposed clients are reclaimed
   * without an explicit teardown step.
   */
  const lastActivityAt = new WeakMap<Client, number>()

  /**
   * In-flight trackers per client. Each entry holds the reject function for
   * the promise returned to the caller; the onclose fast-fail calls every
   * reject so the awaited callTool promise rejects with a typed
   * `TransportClosed` instead of waiting for the SDK timeout. Weak so
   * disposal reclaims the set.
   */
  const inFlight = new WeakMap<Client, Set<{ reject: (error: unknown) => void }>>()

  function now(): number {
    return Date.now()
  }

  function stamp(client: Client): void {
    lastActivityAt.set(client, now())
  }

  function isIdle(client: Client): boolean {
    const last = lastActivityAt.get(client)
    if (last === undefined) return false
    return now() - last >= MCP_IDLE_THRESHOLD_MS
  }

  /**
   * Lazy first-touch stamp. `createClient` does not know which server the
   * client is bound to, so the stamp is set on the first preflight instead
   * of at connect time. Calling preflight is a no-op for non-idle clients,
   * so the very first call after a connect still counts as a fresh activity
   * mark — which matches ADR-237's "no periodic background pings" rule.
   */
  function ensureStamped(client: Client): void {
    if (!lastActivityAt.has(client)) stamp(client)
  }

  /**
   * Wire the onclose fast-fail for a client. Idempotent: re-registering on
   * the same client replaces the previous set so the new transport's
   * in-flight calls are tracked and the old transport's stale callbacks
   * are dropped.
   */
  export function attachClient(client: Client, serverName: string): void {
    const set = new Set<{ reject: (error: unknown) => void }>()
    inFlight.set(client, set)
    const previous = client.onclose
    client.onclose = () => {
      failInFlight(client, serverName)
      if (typeof previous === "function") {
        try {
          previous()
        } catch (error) {
          log.debug("previous onclose handler threw", { server: serverName, error: String(error) })
        }
      }
    }
    ensureStamped(client)
  }

  /**
   * Reject every tracked in-flight call for the given client. Called both
   * from the onclose handler attached in {@link attachClient} and from the
   * `registerClientOnClose` path in `impl.ts` after a transport was
   * closed programmatically.
   */
  export function failInFlight(client: Client, serverName: string): void {
    const set = inFlight.get(client)
    if (!set || set.size === 0) return
    const error = new TransportClosed({ server: serverName })
    // Snapshot before clearing: rejecting inside the callback must not
    // mutate the set we're iterating.
    const pending = [...set]
    set.clear()
    for (const entry of pending) {
      try {
        entry.reject(error)
      } catch (rethrow) {
        log.debug("in-flight reject threw", { server: serverName, error: String(rethrow) })
      }
    }
  }

  /**
   * Register a tracked in-flight call against the client. Returns a
   * discriminated handle: the caller awaits `promise` from inside its own
   * try/catch so the same promise gets rejected by (a) the onclose
   * fast-fail path or (b) the call's own `fail` helper. `finish` removes
   * the registration on success so a stale slot cannot be rejected.
   */
  export function trackCall(client: Client): TrackedCall {
    let set = inFlight.get(client)
    if (!set) {
      set = new Set()
      inFlight.set(client, set)
    }
    let rejectFn!: (error: unknown) => void
    const promise = new Promise<never>((_resolve, reject) => {
      rejectFn = reject
    })
    // The race in the caller observes this promise while the call is awaited,
    // but a transport close can reject it when nobody is listening any more
    // (for example after a preflight failure). Mark it handled so that never
    // surfaces as an unhandled rejection; the caller still sees the rejection
    // through Promise.race.
    promise.catch(() => {})
    const entry = { reject: rejectFn }
    set.add(entry)
    return {
      promise,
      finish: () => {
        const current = inFlight.get(client)
        if (!current) return
        current.delete(entry)
      },
      fail: (error) => {
        const current = inFlight.get(client)
        if (!current) return
        current.delete(entry)
        rejectFn(error)
      },
    }
  }

  export type TrackedCall = {
    /** Awaits until the transport closes or the call's own fail() rejects. */
    readonly promise: Promise<never>
    /** Remove the registration on success so a stale slot cannot be rejected. */
    finish: () => void
    /** Force a rejection (used by the call's own catch path; onclose fast-fail uses the same entry). */
    fail: (error: unknown) => void
  }

  /**
   * Outcome of an idle preflight. `retried === true` means the caller must
   * re-issue the call once because the previous client was declared dead
   * and reconnected.
   */
  export type Preflight = { client: Client; retried: boolean }

  /**
   * ADR-237: before a tool call on a server idle for more than 5 minutes,
   * send a ping with a 2s timeout; on failure reconnect once through the
   * existing connect path and retry the call once if it never reached the
   * server. The reconnection is provided by the caller as a `reconnect`
   * thunk so this module does not import the MCP namespace (which would
   * create a circular dependency between `tool-conversion.ts` and `impl.ts`).
   */
  export async function preflightCall(client: Client, reconnect: () => Promise<Client>): Promise<Preflight> {
    ensureStamped(client)
    if (!isIdle(client)) {
      stamp(client)
      return { client, retried: false }
    }
    // The ping is the fast probe: a healthy server answers within the 2s
    // budget and we continue with the existing client. A failed ping
    // (timeout or thrown error before the SDK sent anything) triggers a
    // reconnect through the supplied thunk; the caller then retries the
    // call once on the fresh client.
    let pingOk = false
    try {
      await withTimeout(pingClient(client), MCP_IDLE_PING_TIMEOUT_MS, "mcp idle ping timeout")
      pingOk = true
    } catch (error) {
      log.debug("mcp idle ping failed; reconnecting", { error: String(error) })
    }
    if (pingOk) {
      stamp(client)
      return { client, retried: false }
    }
    try {
      const next = await reconnect()
      stamp(next)
      return { client: next, retried: true }
    } catch (error) {
      // Reconnect failed; surface the original ping failure to the caller
      // by returning the dead client. The callTool wrapper will track it
      // and the onclose fast-fail will reject in flight when the transport
      // does eventually close.
      log.warn("mcp reconnect after idle-ping failure also failed", { error: String(error) })
      return { client, retried: false }
    }
  }

  /**
   * Test seam: clear the in-memory activity map and the in-flight tracker
   * for a specific client. Production code never needs this — the WeakMap
   * entries die with the client.
   */
  export function _resetForTests(client: Client): void {
    lastActivityAt.delete(client)
    inFlight.delete(client)
  }
}

/** Mirror the SDK's client.ping() so a typed SDK upgrade shows up here. */
async function pingClient(client: { ping?: () => Promise<unknown> }): Promise<unknown> {
  if (typeof client.ping === "function") return client.ping()
  // The SDK v2 client always has ping; this fallback covers any future
  // contract change by calling listTools({}) as a soft probe.
  const anyClient = client as unknown as { listTools?: () => Promise<unknown> }
  if (typeof anyClient.listTools === "function") return anyClient.listTools()
  throw new Error("MCP client exposes no ping or listTools probe")
}
