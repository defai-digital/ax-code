/**
 * Connection state — the single source of truth for the app's event-stream
 * connection phase (SPEC-2026-08-30, S4.7).
 *
 * Ownership: this store is written EXCLUSIVELY by the sync event pipeline's
 * transport hooks (`src/sync/event-pipeline.ts` — the owner of the app's
 * `createEventTransport` instance) through `markStreamConnected` /
 * `markStreamDisconnected`. Nobody else writes it; UI stores, components, and
 * debug tooling read it. The write-surface registry is enforced by
 * `script/check-desktop-store-boundaries.ts` (R5).
 *
 * Distinct from server-reachability probes (`useConfigStore.probeConnection` /
 * `checkConnection`): a probe answers "is the server's HTTP health endpoint
 * reachable right now" at boot or before failing a send; this store answers
 * "is the event stream connected". Probes must never write here — a healthy
 * HTTP endpoint does not imply a live stream.
 *
 * This module lives in `lib/event-stream/` (not `stores/`) so the boundary
 * direction stays one-way: the transport layer must not import `stores/`,
 * while `stores/` and components may read from here. The state is deliberately
 * NOT persisted — a stale persisted phase would lie on every app start.
 */

import { create } from "zustand"
import { defineStore } from "../store-registry"

export type ConnectionPhase = "connecting" | "connected" | "reconnecting"

export type ConnectionState = {
  phase: ConnectionPhase
  hasEverConnected: boolean
  lastDisconnectReason: string | null
}

const INITIAL_CONNECTION_STATE: ConnectionState = {
  phase: "connecting",
  hasEverConnected: false,
  lastDisconnectReason: null,
}

export const useConnectionStore = defineStore(
  "useConnectionStore",
  { domain: "connection", tier: "app" },
  create<ConnectionState>(() => ({ ...INITIAL_CONNECTION_STATE })),
)

/** Derived convenience: true exactly while the stream is connected. */
export const selectIsConnected = (state: ConnectionState): boolean => state.phase === "connected"

/**
 * Writer API — called only by the event pipeline (R5 writer registry):
 * on the server subscription acknowledgement (SSE `server.connected` frame,
 * WS ready frame) and on transport switches, which are treated as connected.
 * The disconnect reason is intentionally kept so a subsequent reconnecting
 * banner can still explain the previous outage.
 */
export const markStreamConnected = (): void => {
  useConnectionStore.setState({ phase: "connected", hasEverConnected: true })
}

/**
 * Writer API — called only by the event pipeline (R5 writer registry) when
 * the stream drops. Before the first successful connect the phase stays
 * "connecting" (initial boot, not an outage); afterwards it becomes
 * "reconnecting".
 */
export const markStreamDisconnected = (reason: string): void => {
  useConnectionStore.setState((state) => ({
    phase: state.hasEverConnected ? "reconnecting" : "connecting",
    lastDisconnectReason: reason,
  }))
}
