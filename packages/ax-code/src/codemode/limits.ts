/** Hard ceilings. Configuration can only lower these values. */
export const LIMITS = Object.freeze({
  max_duration_ms: 30_000,
  max_tool_calls: 200,
  max_steps: 1_000_000,
  max_result_bytes: 1_048_576,
  max_ast_depth: 100,
  max_call_depth: 64,
  max_collection_size: 100_000,
  max_string_bytes: 1_048_576,
  max_source_bytes: 1_048_576,
  max_heap_units: 4_000_000,
})
export type Limits = { -readonly [K in keyof typeof LIMITS]: number }
export type Diagnostic = {
  error: string
  message?: string
  limit?: string
  line?: number
  column?: number
  excerpt?: string
}
export class Fault extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message ?? diagnostic.limit ?? diagnostic.error)
  }
}
export class Budget {
  readonly limits: Limits
  exhausted?: Fault
  lastClockStep = 0
  steps = 0
  toolCalls = 0
  heap = 0
  readonly started: number
  constructor(
    overrides: Partial<Limits> = {},
    readonly signal: AbortSignal = new AbortController().signal,
    readonly clock: () => number = Date.now,
  ) {
    this.started = clock()
    this.limits = { ...LIMITS }
    for (const key of Object.keys(LIMITS) as (keyof Limits)[]) {
      const value = overrides[key]
      if (value !== undefined && Number.isSafeInteger(value) && value > 0)
        this.limits[key] = Math.min(value, LIMITS[key])
    }
  }
  fail(limit: string): never {
    this.exhausted ??= new Fault({ error: "LimitExceeded", limit })
    throw this.exhausted
  }
  check() {
    if (this.exhausted) throw this.exhausted
    if (this.signal.aborted) throw new Fault({ error: "Aborted" })
    if (this.clock() - this.started >= this.limits.max_duration_ms) this.fail("duration_ms")
  }
  step(count = 1) {
    this.steps += count
    if (this.steps > this.limits.max_steps) this.fail("steps")
    if (this.steps - this.lastClockStep >= 128) {
      this.lastClockStep = this.steps
      this.check()
    }
  }
  allocate(units: number) {
    this.heap += units
    if (this.heap > this.limits.max_heap_units) this.fail("heap_units")
  }
  size(size: number) {
    if (size > this.limits.max_collection_size) this.fail("collection_size")
  }
  string(value: string) {
    const bytes = Buffer.byteLength(value)
    if (bytes > this.limits.max_string_bytes) this.fail("string_bytes")
    this.allocate(bytes)
    return value
  }
}
