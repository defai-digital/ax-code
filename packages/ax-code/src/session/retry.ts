import type { NamedError } from "@ax-code/util/error"
import { MessageV2 } from "./message-v2"
import { parseJsonRecord } from "@/util/json-record"
import { GITHUB_REPO_URL } from "@/constants/project"
import { isRecord } from "@/util/record"

export namespace SessionRetry {
  const RETRY_INITIAL_DELAY = 2000
  const RETRY_BACKOFF_FACTOR = 2
  const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout
  export const RETRY_MAX_ATTEMPTS = 5
  const ALIBABA_TOKEN_PLAN_QUOTA_RETRY_DELAY = 60_000
  // Extended attempt budget for concurrency-limit hits only: a saturated
  // shared pool routinely outlasts the generic 5-attempt budget, so this class
  // gets more attempts before the turn gives up (processor-impl.ts consumes
  // this via maxAttemptsFor(); every other retryable condition keeps
  // RETRY_MAX_ATTEMPTS).
  export const CONCURRENCY_RETRY_MAX_ATTEMPTS = 8
  // Stable machine-readable code for the terminal error a concurrency-limit
  // hit produces once its extended attempt budget is exhausted. The outer
  // prompt loop (prompt-loop-errors.ts) exempts this code from its generic
  // "isRetryable: false -> stop immediately" rule, since this class remains
  // retryable in principle — only this one attempt sequence gave up.
  export const PROVIDER_CONCURRENCY_EXHAUSTED_ERROR_CODE = "provider_concurrency_exhausted"
  // Server Retry-After cap for concurrency-limit hits only. The generic cap
  // (RETRY_MAX_DELAY_NO_HEADERS, 30s) still applies to every other header use.
  const CONCURRENCY_HEADER_DELAY_CAP_MS = 120_000
  // Hard ceiling on any single concurrency retry delay, applied after the
  // streak-proportional escalation and jitter.
  const CONCURRENCY_MAX_DELAY_CEILING_MS = 300_000

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      timeout.unref?.()
      if (signal.aborted) {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  function isAlibabaTokenPlanShortWindowQuota(error: MessageV2.APIError) {
    return error.data.metadata?.errorCode === "alibaba_token_plan_short_window_quota"
  }

  /**
   * A concurrency limit means another request still holds the lease until
   * that generation finishes. AX Trust used to advertise Retry-After: 1 for
   * this case, and five of those waits expired the retry budget in about 5
   * seconds (session ses_-e5f3a5d6974ffexB8P6pzBD4t). A hint shorter than
   * the exponential delay is ignored. A longer hint, including Trust's
   * 10-second floor, still wins.
   */
  function isConcurrencyLimit(error: MessageV2.APIError) {
    const record = parseJsonRecord(error.data.responseBody)
    if (!record) return false
    if (record.code === "concurrency_limit_exceeded") return true
    const nested = isRecord(record.error) ? record.error : undefined
    return nested?.code === "concurrency_limit_exceeded"
  }

  function exponentialDelay(attempt: number, ceiling = RETRY_MAX_DELAY_NO_HEADERS) {
    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), ceiling)
  }

  function numericHeaderDelay(value: string | undefined, multiplier: number, cap = RETRY_MAX_DELAY_NO_HEADERS) {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return undefined

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) return undefined

    return Math.min(Math.ceil(parsed * multiplier), cap)
  }

  function retryAfterDelay(value: string | undefined, cap = RETRY_MAX_DELAY_NO_HEADERS) {
    const secondsDelay = numericHeaderDelay(value, 1000, cap)
    if (secondsDelay !== undefined) return secondsDelay
    if (value === undefined) return undefined

    const parsed = Date.parse(value) - Date.now()
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(Math.ceil(parsed), cap)
    return undefined
  }

  function headerDelay(headers: MessageV2.APIError["data"]["responseHeaders"], cap = RETRY_MAX_DELAY_NO_HEADERS) {
    const retryAfterMs = numericHeaderDelay(headers?.["retry-after-ms"], 1, cap)
    if (retryAfterMs !== undefined) return retryAfterMs

    return retryAfterDelay(headers?.["retry-after"], cap)
  }

  function normalizedAttempt(attempt: number) {
    return Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1
  }

  export function delay(attempt: number, error?: MessageV2.APIError, providerID?: string) {
    const effectiveAttempt = normalizedAttempt(attempt)
    const exponential = exponentialDelay(effectiveAttempt)
    if (error) {
      const headers = error.data.responseHeaders
      if (isAlibabaTokenPlanShortWindowQuota(error)) {
        const parsedHeaderDelay = headerDelay(headers)
        if (parsedHeaderDelay !== undefined) return parsedHeaderDelay
        return floorJitter(ALIBABA_TOKEN_PLAN_QUOTA_RETRY_DELAY)
      }
      if (isConcurrencyLimit(error)) {
        // Concurrency hits get a separate, streak-proportional budget: the
        // per-attempt ceiling stretches 30s -> 60s -> 120s as consecutive
        // hits accumulate, and the server Retry-After cap rises to 120s so a
        // saturated shared pool can wait out a competing generation's lease.
        const ceiling = concurrencyDelayCeiling(concurrencyStreakFor(providerID))
        const concurrencyExponential = exponentialDelay(effectiveAttempt, ceiling)
        const parsedHeaderDelay = headers ? headerDelay(headers, CONCURRENCY_HEADER_DELAY_CAP_MS) : undefined
        // A 1-second concurrency hint must not undercut the exponential floor.
        // A longer server hint (up to the raised cap) still wins.
        if (parsedHeaderDelay !== undefined && parsedHeaderDelay >= concurrencyExponential)
          return Math.min(parsedHeaderDelay, CONCURRENCY_MAX_DELAY_CEILING_MS)
        return Math.min(floorJitter(concurrencyExponential), CONCURRENCY_MAX_DELAY_CEILING_MS)
      }
      const parsedHeaderDelay = headers ? headerDelay(headers) : undefined
      if (parsedHeaderDelay !== undefined) return parsedHeaderDelay
      if (headers) return jitter(exponential)
    }

    return jitter(exponential)
  }

  /** Add +/-25% jitter to prevent thundering herd on simultaneous retries. */
  function jitter(ms: number): number {
    return Math.round(ms * (0.75 + Math.random() * 0.5))
  }

  /**
   * One-sided jitter for values that are floors: a concurrency lease or quota
   * window that the code just refused to undercut must not be undercut by
   * the jitter itself, so spread upward only (+0..25%).
   */
  function floorJitter(ms: number): number {
    return Math.round(ms * (1 + Math.random() * 0.25))
  }

  // Patterns that indicate the error is permanent — retrying the same
  // request won't fix it. The AI SDK marks all 429s as isRetryable, but
  // some 429s are billing/quota exhaustion, not rate limits. Retrying
  // those wastes ~60s of backoff before the user sees the real error.
  const NON_RETRYABLE_PATTERNS = [
    "allocated quota exceeded",
    "insufficient balance",
    "increase your quota limit",
    "no resource package",
    "quota exceeded",
    "quota has been exhausted",
    "token-limit",
    "insufficient quota",
    "insufficient_quota",
    "billing",
    "payment required",
    "account suspended",
    "subscription",
  ]

  // Network-level failures that rarely recover within a single prompt step.
  // After NETWORK_CIRCUIT_THRESHOLD consecutive hits we open the circuit for
  // NETWORK_CIRCUIT_COOLDOWN_MS so the session fails fast instead of burning
  // the full retry budget on a dead path (STAB-14).
  // Circuit state is tracked per-provider so one failing provider does not
  // block retries for unrelated providers (STAB-14b).
  const NETWORK_FAILURE_PATTERNS = [
    "enotfound",
    "econnrefused",
    "econnreset",
    "etimedout",
    "eai_again",
    "network error",
    "fetch failed",
    "socket hang up",
    "connection reset",
    "getaddrinfo",
  ]
  const NETWORK_CIRCUIT_THRESHOLD = 3
  const NETWORK_CIRCUIT_COOLDOWN_MS = 30_000
  const CIRCUIT_MAX_PROVIDERS = 64

  interface CircuitState {
    failureStreak: number
    openUntil: number
    concurrencyStreak: number
  }

  const circuits = new Map<string, CircuitState>()

  function circuitFor(providerID: string | undefined): CircuitState {
    const key = providerID ?? "__global__"
    let state = circuits.get(key)
    if (!state) {
      // Evict the first-inserted entry at capacity (FIFO; access does not
      // refresh order). Losing a live provider's streak is harmless.
      if (circuits.size >= CIRCUIT_MAX_PROVIDERS) {
        const oldest = circuits.keys().next().value
        if (oldest !== undefined) circuits.delete(oldest)
      }
      state = { failureStreak: 0, openUntil: 0, concurrencyStreak: 0 }
      circuits.set(key, state)
    }
    return state
  }

  function concurrencyStreakFor(providerID: string | undefined): number {
    return circuits.get(providerID ?? "__global__")?.concurrencyStreak ?? 0
  }

  function concurrencyDelayCeiling(streak: number): number {
    if (streak < 2) return RETRY_MAX_DELAY_NO_HEADERS
    if (streak < 4) return 60_000
    return 120_000
  }

  function isNetworkFailure(message: string, responseBody?: string): boolean {
    const lower = `${message}\n${responseBody ?? ""}`.toLowerCase()
    return NETWORK_FAILURE_PATTERNS.some((p) => lower.includes(p))
  }

  function isPermanentError(message: string, responseBody?: string): boolean {
    const lower = `${message}\n${responseBody ?? ""}`.toLowerCase()
    return NON_RETRYABLE_PATTERNS.some((p) => lower.includes(p))
  }

  /** Test helper — reset circuit state between unit tests. */
  export function resetNetworkCircuit(providerID?: string) {
    if (providerID) {
      circuits.delete(providerID)
    } else {
      circuits.clear()
    }
  }

  /**
   * Record a successful provider step so intermittent network failures
   * separated by successes never accumulate toward the circuit threshold;
   * only consecutive failures should open the circuit (STAB-14).
   */
  export function recordNetworkSuccess(providerID?: string) {
    const state = circuits.get(providerID ?? "__global__")
    if (state) state.failureStreak = 0
  }

  /**
   * Record a successful provider step so intermittent concurrency-limit hits
   * separated by successes never accumulate toward the stretched delay
   * ceiling; only consecutive hits should escalate the delay.
   */
  export function recordConcurrencySuccess(providerID?: string) {
    const state = circuits.get(providerID ?? "__global__")
    if (state) state.concurrencyStreak = 0
  }

  export function networkCircuitOpen(providerID?: string, now = Date.now()): boolean {
    const state = circuits.get(providerID ?? "__global__")
    if (!state) return false
    return now < state.openUntil
  }

  export function parseRetryMessageJson(message: unknown): Record<string, unknown> | undefined {
    return typeof message === "string" ? parseJsonRecord(message) : undefined
  }

  export function retryable(error: ReturnType<NamedError["toObject"]>, providerID?: string) {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      const message = typeof error.data?.message === "string" ? error.data.message : "Unknown API error"
      const circuit = circuitFor(providerID)
      // Concurrency-limit and Alibaba short-window-quota hits are always
      // retryable, independent of the SDK's isRetryable flag — a gateway may
      // mark a transient 429 non-retryable even though retrying after the
      // competing lease releases is the correct behavior. Check both before
      // the isRetryable early exit so the "always retry, never open a
      // circuit" intent cannot be short-circuited.
      if (isAlibabaTokenPlanShortWindowQuota(error)) {
        circuit.failureStreak = 0
        return message
      }
      if (isConcurrencyLimit(error)) {
        circuit.failureStreak = 0
        circuit.concurrencyStreak += 1
        return message
      }
      if (!error.data?.isRetryable) return undefined
      // Billing / quota exhaustion — retrying won't change the account
      // balance. Surface the error immediately instead of burning 60s
      // of exponential backoff. This overrides the AI SDK's blanket
      // `isRetryable: true` on all 429 responses.
      if (isPermanentError(message, error.data.responseBody)) return undefined

      if (isNetworkFailure(message, error.data.responseBody)) {
        if (networkCircuitOpen(providerID)) return undefined
        circuit.failureStreak += 1
        if (circuit.failureStreak >= NETWORK_CIRCUIT_THRESHOLD) {
          circuit.openUntil = Date.now() + NETWORK_CIRCUIT_COOLDOWN_MS
          circuit.failureStreak = 0
          return undefined
        }
      } else {
        circuit.failureStreak = 0
      }

      if (error.data.responseBody?.includes("FreeUsageLimitError"))
        return `Free usage exceeded, add credits ${GITHUB_REPO_URL}`
      return message.includes("Overloaded") ? "Provider is overloaded" : message
    }

    const json = parseRetryMessageJson(error.data?.message)
    if (!json) return undefined

    const circuit = circuitFor(providerID)
    const code = typeof json.code === "string" ? json.code : ""
    const nestedError = isRecord(json.error) ? json.error : undefined
    if (json.type === "error" && nestedError?.type === "too_many_requests") {
      circuit.failureStreak = 0
      return "Too Many Requests"
    }
    if (code.includes("exhausted") || code.includes("unavailable")) {
      circuit.failureStreak = 0
      return "Provider is overloaded"
    }
    const nestedCode = nestedError && typeof nestedError.code === "string" ? nestedError.code : ""
    if (json.type === "error" && nestedCode.includes("rate_limit")) {
      circuit.failureStreak = 0
      return "Rate Limited"
    }
    return undefined
  }

  /**
   * The attempt budget for a retryable error. Concurrency-limit hits get the
   * extended CONCURRENCY_RETRY_MAX_ATTEMPTS budget because a saturated shared
   * pool routinely outlasts the generic budget; every other retryable
   * condition keeps RETRY_MAX_ATTEMPTS. Callers that classify the provider
   * error themselves must go through this helper rather than reading
   * RETRY_MAX_ATTEMPTS directly (processor-impl.ts does).
   */
  export function maxAttemptsFor(error?: MessageV2.APIError): number {
    return error !== undefined && isConcurrencyLimit(error) ? CONCURRENCY_RETRY_MAX_ATTEMPTS : RETRY_MAX_ATTEMPTS
  }

  /**
   * A stable machine-readable code for the terminal error emitted when a
   * concurrency-limit hit exhausts its retry budget. processor-impl.ts places
   * this in the terminal error's `metadata.errorCode` bag
   * (`error.data.metadata.errorCode = terminalErrorCode(error)`) rather than
   * a message-suffix a caller would have to parse; prompt-loop-errors.ts's
   * outer retry layer keys its non-retryable-error exemption on this code.
   */
  export function terminalErrorCode(error: MessageV2.APIError): string | undefined {
    return isConcurrencyLimit(error) ? PROVIDER_CONCURRENCY_EXHAUSTED_ERROR_CODE : undefined
  }
}
