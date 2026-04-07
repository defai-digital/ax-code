/**
 * Lightweight Result type for explicit error handling in critical paths.
 *
 * Use for: tool execution, file mutation, LLM response normalization, config loading.
 * Do NOT use for: simple helpers, internal plumbing, or trivial operations.
 *
 * @example
 * ```ts
 * async function loadConfig(path: string): Promise<Result<Config, ConfigError>> {
 *   try {
 *     const raw = await fs.readFile(path, "utf8")
 *     return Result.ok(JSON.parse(raw))
 *   } catch (e) {
 *     return Result.err({ code: "CONFIG_LOAD_FAILED", cause: e })
 *   }
 * }
 *
 * const config = await loadConfig("ax-code.json")
 * if (!config.ok) {
 *   log.error("config failed", { errorCode: config.error.code })
 *   return
 * }
 * // config.value is Config here
 * ```
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E }

export namespace Result {
  export function ok<T>(value: T): Result<T, never> {
    return { ok: true, value }
  }

  export function err<E>(error: E): Result<never, E> {
    return { ok: false, error }
  }

  /** Wrap an async operation into a Result. */
  export async function fromPromise<T, E = Error>(
    promise: Promise<T>,
    mapError?: (e: unknown) => E,
  ): Promise<Result<T, E>> {
    try {
      return ok(await promise)
    } catch (e) {
      return err(mapError ? mapError(e) : (e as E))
    }
  }

  /** Wrap a sync operation into a Result. */
  export function fromThrowable<T, E = Error>(
    fn: () => T,
    mapError?: (e: unknown) => E,
  ): Result<T, E> {
    try {
      return ok(fn())
    } catch (e) {
      return err(mapError ? mapError(e) : (e as E))
    }
  }

  /** Map the value of a successful Result. */
  export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.ok ? ok(fn(result.value)) : result
  }

  /** Map the error of a failed Result. */
  export function mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    return result.ok ? result : err(fn(result.error))
  }

  /** Unwrap a Result, throwing on error. Use only at boundaries. */
  export function unwrap<T, E>(result: Result<T, E>): T {
    if (result.ok) return result.value
    throw result.error instanceof Error ? result.error : new Error(String(result.error))
  }

  /** Unwrap a Result with a default value on error. */
  export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue
  }
}
