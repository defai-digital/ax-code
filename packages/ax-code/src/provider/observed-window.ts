// Observed context-window calibration (ADR-139 D3). Catalog context limits
// are a snapshot; gateways sometimes serve models behind shrunken windows,
// producing overflow → compact → re-overflow loops. This module consumes only
// the existing `context_overflow` error class plus exact-usage successes and
// maintains a per-route boundary model of the real window:
//
// - Provider-stated limits extracted from error bodies win (one confirmation
//   suffices, still clamped to the catalog limit: gateways shrink, never grow).
// - Otherwise the failure prompt size is an upper bound and the largest
//   successfully sent prompt is the lower bound; the persisted value never
//   goes below that floor or above the catalog limit. A single overflow is
//   in-memory only; persistence requires two confirmations.
// - Success above a stored value ratchets it upward.
// - A value below the plausibility floor does not clamp the window: the
//   route becomes "unknown" and auto-compaction is disabled for it.
// - Persistence is project-scoped local state (.ax-code/observed-windows.json),
//   zod-validated on load, bounded, TTL-expired (30 days), invalidated when
//   the catalog fingerprint changes, and clearable (doctor path).

import fs from "fs/promises"
import path from "path"
import z from "zod"
import type { Provider } from "./provider"
import { TokenLedger } from "./token-ledger"
import { parseJsonRecord } from "@/util/json-record"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "provider.observed-window" })

export namespace ObservedWindow {
  export const MIN_PLAUSIBLE_WINDOW = 4_096
  export const WINDOW_TTL_MS = 30 * 24 * 60 * 60 * 1_000
  export const MAX_RECORDS = 256

  export type ObservedWindowRecord = {
    window: number
    evidence: "provider-stated" | "boundary"
    confirmations: number
    maxSuccessfulPromptTokens: number
    catalogFingerprint: string
    endpointOrigin?: string
    updatedAt: number
  }

  export type WindowResolution =
    | { kind: "observed"; window: number; record: ObservedWindowRecord }
    | { kind: "catalog" }
    | { kind: "unknown" }

  export function catalogFingerprintFor(catalogLimit: number): string {
    return TokenLedger.sha256(String(catalogLimit))
  }

  // Provider-stated limit extraction. Covers the overflow message families in
  // provider/error.ts plus structured fields OpenAI-compatible gateways emit.
  const STATED_LIMIT_PATTERNS = [
    /maximum context length is (\d+) tokens/i,
    /context length is only (\d+) tokens/i,
    /maximum prompt length is (\d+)(?:\s+tokens)?/i,
    /exceeds the limit of (\d+)(?:\s+tokens)?/i,
  ]

  const STRUCTURED_LIMIT_KEYS = [
    "context_window",
    "max_model_len",
    "max_context_tokens",
    "context_length",
    "contextWindow",
  ]

  function structuredLimit(value: unknown, depth: number): number | undefined {
    const record = parseJsonRecord(value)
    if (!record) return undefined
    for (const key of STRUCTURED_LIMIT_KEYS) {
      const candidate = record[key]
      const parsed =
        typeof candidate === "number" && Number.isFinite(candidate)
          ? candidate
          : typeof candidate === "string" && /^\d+$/.test(candidate)
            ? Number(candidate)
            : undefined
      if (parsed !== undefined && parsed > 0) return Math.floor(parsed)
    }
    if (depth > 0) {
      for (const nested of Object.values(record)) {
        if (nested && typeof nested === "object") {
          const found = structuredLimit(nested, depth - 1)
          if (found !== undefined) return found
        }
      }
    }
    return undefined
  }

  /**
   * Extract a provider-stated token limit from an overflow error message or
   * response body. Message text wins; then the body text; then structured
   * JSON fields (`context_window`, `max_model_len`, ...).
   */
  export function extractStatedLimit(message: string, responseBody?: string): number | undefined {
    for (const pattern of STATED_LIMIT_PATTERNS) {
      const match = pattern.exec(message)
      if (match?.[1]) {
        const parsed = Number.parseInt(match[1], 10)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
      }
    }
    if (responseBody) {
      for (const pattern of STATED_LIMIT_PATTERNS) {
        const match = pattern.exec(responseBody)
        if (match?.[1]) {
          const parsed = Number.parseInt(match[1], 10)
          if (Number.isFinite(parsed) && parsed > 0) return parsed
        }
      }
      const structured = structuredLimit(responseBody, 2)
      if (structured !== undefined) return structured
    }
    return undefined
  }

  /**
   * Route key for the resolved inference identity: provider ID + resolved
   * upstream model ID, plus the endpoint origin for custom/OpenAI-compatible
   * providers (same provider/model served from different endpoints must not
   * share a window). Bare user aliases are not a key.
   */
  export function routeKeyFor(model: Provider.Model): string {
    const base = `${model.providerID}/${model.id}`
    if (model.api.npm === "@ai-sdk/openai-compatible") {
      const origin = endpointOrigin(model.api.url)
      if (origin) return `${base}@${origin}`
    }
    return base
  }

  function endpointOrigin(url: string): string | undefined {
    try {
      return new URL(url).origin
    } catch {
      return undefined
    }
  }

  const RecordSchema = z.object({
    window: z.number().int().positive(),
    evidence: z.enum(["provider-stated", "boundary"]),
    confirmations: z.number().int().min(1),
    maxSuccessfulPromptTokens: z.number().min(0),
    catalogFingerprint: z.string().min(1),
    endpointOrigin: z.string().optional(),
    updatedAt: z.number().int().min(0),
  })

  const FileSchema = z.object({
    version: z.literal(1),
    records: z.record(z.string(), z.unknown()),
    unknown: z.array(z.unknown()).optional(),
  })

  export type StoreOptions = {
    /** JSON persistence path; omit for an in-memory-only store. */
    filePath?: string
    now?: () => number
  }

  export class ObservedWindowStore {
    private readonly filePath?: string
    private readonly now: () => number
    private records = new Map<string, ObservedWindowRecord>()
    private unknownRoutes = new Set<string>()
    // Observed-success floor per route, tracked separately from window
    // records: a served prompt proves the window is at least this large, but
    // must not by itself become the window cap (that would trigger
    // auto-compaction on every prompt-growth step). Folded into records when
    // they exist or get created by an overflow. In-memory only.
    private floors = new Map<string, number>()
    private loaded: Promise<void> | undefined
    private dirty = false

    constructor(options: StoreOptions = {}) {
      this.filePath = options.filePath
      this.now = options.now ?? Date.now
    }

    private ensureLoaded(): Promise<void> {
      if (!this.filePath) return Promise.resolve()
      this.loaded ??= this.load().catch((error) => {
        // Corrupt or unreadable persisted state must never break prompt flow;
        // start from empty in-memory state instead.
        log.warn("observed-window load failed; starting empty", { error })
      })
      return this.loaded
    }

    private async load(): Promise<void> {
      if (!this.filePath) return
      let text: string
      try {
        text = await fs.readFile(this.filePath, "utf-8")
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return
        throw error
      }
      const parsed = parseJsonRecord(text)
      if (!parsed) {
        log.warn("observed-windows file is not a JSON object; ignoring", { filePath: this.filePath })
        return
      }
      const validated = FileSchema.safeParse(parsed)
      if (!validated.success) {
        log.warn("observed-windows file failed schema validation; ignoring", {
          filePath: this.filePath,
          error: validated.error.message,
        })
        return
      }
      // Per-entry validation: invalid entries are dropped, the rest survive.
      for (const [routeKey, value] of Object.entries(validated.data.records)) {
        const record = RecordSchema.safeParse(value)
        if (record.success) {
          this.records.set(routeKey, record.data)
          this.floors.set(routeKey, Math.max(this.floors.get(routeKey) ?? 0, record.data.maxSuccessfulPromptTokens))
        } else {
          log.warn("dropping invalid observed-window entry", { routeKey, error: record.error.message })
        }
      }
      for (const routeKey of validated.data.unknown ?? []) {
        if (typeof routeKey === "string") this.unknownRoutes.add(routeKey)
      }
    }

    private async persist(): Promise<void> {
      if (!this.filePath || !this.dirty) return
      this.dirty = false
      // Bound: keep the newest MAX_RECORDS by updatedAt.
      const entries = [...this.records.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      const dropped = entries.splice(MAX_RECORDS)
      this.records = new Map(entries)
      for (const [routeKey] of dropped) {
        log.info("evicted oldest observed-window record", { routeKey })
      }
      const payload = {
        version: 1 as const,
        records: Object.fromEntries(
          [...this.records].filter(([, record]) => record.evidence === "provider-stated" || record.confirmations >= 2),
        ),
        unknown: [...this.unknownRoutes],
      }
      try {
        await Filesystem.write(this.filePath, JSON.stringify(payload, null, 2))
      } catch (error) {
        log.warn("observed-window persist failed", { filePath: this.filePath, error })
      }
    }

    private touch(): void {
      this.dirty = true
    }

    /**
     * Record a successfully served prompt: ratchets the observed-success
     * floor upward and, when it clears a stored window or an unknown-route
     * mark, ratchets/repairs the window (success above a stored value moves
     * it up; read-time clamping keeps it under the catalog limit).
     */
    async recordSuccess(
      routeKey: string,
      promptTokens: number,
      options: { catalogLimit?: number } = {},
    ): Promise<void> {
      await this.ensureLoaded()
      if (!Number.isFinite(promptTokens) || promptTokens < 0) return
      const tokens = Math.floor(promptTokens)
      const existing = this.currentRecord(routeKey, options.catalogLimit)
      this.floors.set(routeKey, Math.max(this.floors.get(routeKey) ?? 0, tokens))
      if (existing) {
        // Only a REAL ratchet refreshes the freshness clock. Refreshing it on
        // every success would pin a stale shrunken window forever: compaction
        // keeps prompts under the (wrong) cap, so the window can never ratchet
        // up and the 30-day TTL documented for these records would never fire.
        const ratcheted = tokens > existing.window
        this.records.set(routeKey, {
          ...existing,
          window: Math.max(existing.window, tokens),
          maxSuccessfulPromptTokens: Math.max(existing.maxSuccessfulPromptTokens, tokens),
          updatedAt: ratcheted ? this.now() : existing.updatedAt,
        })
        if (ratcheted || tokens > existing.maxSuccessfulPromptTokens) this.touch()
      }
      if (this.unknownRoutes.has(routeKey) && tokens >= MIN_PLAUSIBLE_WINDOW) {
        // Recovery: the route previously looked below the plausibility floor,
        // but a real prompt at this size went through — rebuild a boundary
        // window from the proven success size.
        this.unknownRoutes.delete(routeKey)
        const catalogFingerprint =
          options.catalogLimit !== undefined && options.catalogLimit > 0
            ? catalogFingerprintFor(options.catalogLimit)
            : ""
        // catalogFingerprint must be non-empty per schema (z.string().min(1)).
        // If the caller didn't provide a catalogLimit, we cannot persist a valid
        // record; the in-memory record still works for this session but won't
        // survive a reload. Callers should always pass catalogLimit.
        this.records.set(routeKey, {
          window: tokens,
          evidence: "boundary",
          confirmations: 1,
          maxSuccessfulPromptTokens: this.floors.get(routeKey) ?? tokens,
          catalogFingerprint,
          updatedAt: this.now(),
        })
        this.touch()
      }
      await this.persist()
    }

    /**
     * Record a context-overflow failure. `statedLimit` (extracted from the
     * error) wins with one confirmation; otherwise the failure prompt size is
     * the boundary candidate, clamped to [success floor, catalog limit].
     * In-memory immediately; persisted at two confirmations (stated limits
     * persist on first sight). Below the plausibility floor the route is
     * marked unknown instead of clamping the window.
     */
    async recordOverflow(
      routeKey: string,
      promptTokens: number,
      options: { statedLimit?: number; catalogLimit: number },
    ): Promise<void> {
      await this.ensureLoaded()
      const catalogLimit = Math.floor(options.catalogLimit)
      if (!Number.isFinite(catalogLimit) || catalogLimit <= 0) return
      const statedLimit = options.statedLimit
      const hasStatedLimit = statedLimit !== undefined && Number.isFinite(statedLimit) && statedLimit > 0
      // Missing/invalid measurements are not evidence of a tiny window. In
      // particular, the no-ledger fallback is zero and must not disable compaction.
      if (!hasStatedLimit && (!Number.isFinite(promptTokens) || Math.floor(promptTokens) <= 0)) return
      const existing = this.currentRecord(routeKey, catalogLimit)
      const floor = Math.max(this.floors.get(routeKey) ?? 0, existing?.maxSuccessfulPromptTokens ?? 0)

      if (options.statedLimit !== undefined && Number.isFinite(options.statedLimit) && options.statedLimit > 0) {
        const window = Math.min(Math.floor(options.statedLimit), catalogLimit)
        if (window < MIN_PLAUSIBLE_WINDOW) {
          this.markUnknown(routeKey)
          await this.persist()
          return
        }
        this.unknownRoutes.delete(routeKey)
        this.records.set(routeKey, {
          window,
          evidence: "provider-stated",
          confirmations: 1,
          maxSuccessfulPromptTokens: floor,
          catalogFingerprint: catalogFingerprintFor(catalogLimit),
          updatedAt: this.now(),
        })
        this.touch()
        await this.persist()
        return
      }

      // Provider-stated evidence is stronger than a later boundary sample;
      // keep it (its own confirmations still stand).
      if (existing?.evidence === "provider-stated") return

      const candidate = Math.min(Math.max(0, Math.floor(promptTokens)), catalogLimit)
      const window = Math.max(candidate, floor)
      if (window < MIN_PLAUSIBLE_WINDOW) {
        this.markUnknown(routeKey)
        await this.persist()
        return
      }
      this.unknownRoutes.delete(routeKey)
      const next: ObservedWindowRecord = {
        window,
        evidence: "boundary",
        confirmations: (existing?.evidence === "boundary" ? existing.confirmations : 0) + 1,
        maxSuccessfulPromptTokens: floor,
        catalogFingerprint: catalogFingerprintFor(catalogLimit),
        updatedAt: this.now(),
      }
      this.records.set(routeKey, next)
      this.touch()
      if (next.confirmations >= 2) await this.persist()
    }

    private markUnknown(routeKey: string): void {
      this.unknownRoutes.add(routeKey)
      this.records.delete(routeKey)
      this.touch()
    }

    private currentRecord(routeKey: string, catalogLimit?: number): ObservedWindowRecord | undefined {
      const record = this.records.get(routeKey)
      if (!record) return undefined
      if (
        this.now() - record.updatedAt <= WINDOW_TTL_MS &&
        (catalogLimit === undefined || record.catalogFingerprint === catalogFingerprintFor(catalogLimit))
      )
        return record
      // Invalidation must apply to writes as well as reads: stale stated
      // evidence otherwise blocks new boundaries, or a success revives it.
      this.records.delete(routeKey)
      this.floors.delete(routeKey)
      this.touch()
      return undefined
    }

    /**
     * Resolve the effective window for a route. Observed wins only while
     * fresh (TTL + catalog fingerprint) and never exceeds the catalog limit.
     * Unknown routes report "unknown" — auto-compaction stays off for them.
     */
    async resolveWindow(routeKey: string, catalogLimit: number): Promise<WindowResolution> {
      await this.ensureLoaded()
      if (this.unknownRoutes.has(routeKey)) return { kind: "unknown" }
      if (!Number.isFinite(catalogLimit) || catalogLimit <= 0) return { kind: "catalog" }
      const record = this.currentRecord(routeKey, catalogLimit)
      if (!record) {
        return { kind: "catalog" }
      }
      return { kind: "observed", window: Math.min(record.window, Math.floor(catalogLimit)), record }
    }

    /** The observed window for a route, or undefined (catalog/unknown/no data). */
    async effectiveWindow(routeKey: string, catalogLimit: number): Promise<number | undefined> {
      const resolved = await this.resolveWindow(routeKey, catalogLimit)
      return resolved.kind === "observed" ? resolved.window : undefined
    }

    /** Doctor/clear path: drop one route or everything, in memory and on disk. */
    async clear(routeKey?: string): Promise<void> {
      await this.ensureLoaded()
      if (routeKey === undefined) {
        this.records.clear()
        this.unknownRoutes.clear()
        this.floors.clear()
      } else {
        this.records.delete(routeKey)
        this.unknownRoutes.delete(routeKey)
        this.floors.delete(routeKey)
      }
      this.touch()
      await this.persist()
    }

    /** Test/inspection helper. */
    snapshot(): { records: Record<string, ObservedWindowRecord>; unknown: string[] } {
      return {
        records: Object.fromEntries(this.records),
        unknown: [...this.unknownRoutes],
      }
    }
  }

  // One store per project worktree. The Instance context is per-request, so a
  // module-level singleton would leak windows across projects (and across
  // isolated test projects); a small LRU keyed by worktree keeps each
  // project's store independent.
  const SINGLETON_MAX = 8
  const singletons = new Map<string, ObservedWindowStore>()

  /** Project-scoped store (`.ax-code/observed-windows.json` under the worktree). */
  export function store(): ObservedWindowStore {
    const key = Instance.worktree
    const existing = singletons.get(key)
    if (existing) {
      singletons.delete(key)
      singletons.set(key, existing)
      return existing
    }
    const created = new ObservedWindowStore({
      // @scan-suppress security_scan - Fixed state filename under the active project's worktree; no route data enters the path.
      filePath: path.join(key, ".ax-code", "observed-windows.json"),
    })
    singletons.set(key, created)
    while (singletons.size > SINGLETON_MAX) {
      const oldest = singletons.keys().next().value
      if (oldest === undefined) break
      singletons.delete(oldest)
    }
    return created
  }

  /** Test-only: drop every cached store. */
  export function _resetStoreForTests(): void {
    singletons.clear()
  }

  /**
   * Overflow calibration entry point. Fires only for the `context_overflow`
   * error class — `request_too_large` (byte limits) and bare-400 fallbacks
   * never calibrate a token window (ADR-139 D3). Never throws: calibration
   * is best-effort and must not disturb error handling.
   */
  export async function recordOverflowEvidence(input: {
    routeKey?: string
    sessionID?: string
    catalogLimit?: number
    message?: string
    responseBody?: string
  }): Promise<void> {
    try {
      if (!input.routeKey) return
      if (input.catalogLimit === undefined || !Number.isFinite(input.catalogLimit) || input.catalogLimit <= 0) return
      const statedLimit = extractStatedLimit(input.message ?? "", input.responseBody)
      const promptTokens =
        input.sessionID !== undefined ? (TokenLedger.forSession(input.sessionID).lastTotal() ?? 0) : 0
      await store().recordOverflow(input.routeKey, promptTokens, {
        statedLimit,
        catalogLimit: input.catalogLimit,
      })
    } catch (error) {
      log.warn("recordOverflowEvidence failed", { error })
    }
  }
}
