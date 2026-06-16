/**
 * Central adapter for native (Rust) addon loading.
 *
 * All runtime access to `@ax-code/fs`, `@ax-code/diff`, `@ax-code/index-core`,
 * and `@ax-code/parser` goes through this module. Call sites should not
 * `require()` these packages directly — this keeps flag checks, error
 * filtering, and fallback semantics in one place.
 *
 * Each accessor:
 *   - returns `undefined` if the feature flag is off
 *   - returns `undefined` if the package is not installed (MODULE_NOT_FOUND)
 *   - returns `undefined` and logs a warning for any other load error
 *   - caches the resolved value (or failure) via `lazy()`
 */

import { createRequire } from "node:module"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

// Type-only imports — erased at compile time, no runtime dependency.
// The napi-rs `.d.ts` declarations provide typed interfaces for each
// native addon so callers get autocomplete and type checking instead
// of opaque `any`.
type FsBinding = typeof import("@ax-code/fs")
type DiffBinding = typeof import("@ax-code/diff")
type IndexBinding = typeof import("@ax-code/index-core")
type ParserBinding = typeof import("@ax-code/parser")

const log = Log.create({ service: "native.addon" })
const _require = createRequire(import.meta.url)

// Cache by package name. We cache the resolved binding (or the MODULE_NOT_FOUND
// outcome) so we don't pay the require cost on every accessor call. The flag
// itself is re-read on every call, so flipping AX_CODE_NATIVE_* at runtime
// (test harnesses, embedders mutating process.env) takes effect immediately.
// Typed `unknown` — each public accessor narrows to its specific binding type.
type CacheEntry = { value: unknown }
const cache = new Map<string, CacheEntry>()

function loadAddon(pkg: string, enabled: boolean): unknown {
  if (!enabled) return undefined
  const cached = cache.get(pkg)
  if (cached) return cached.value
  let value: unknown
  try {
    value = _require(pkg)
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load native addon", { pkg, error: String(e) })
    }
    value = undefined
  }
  cache.set(pkg, { value })
  return value
}

export namespace NativeAddon {
  /** Returns the `@ax-code/fs` binding or `undefined` if unavailable. */
  export function fs(): FsBinding | undefined {
    return loadAddon("@ax-code/fs", Flag.AX_CODE_NATIVE_FS) as FsBinding | undefined
  }

  /** Returns the `@ax-code/diff` binding or `undefined` if unavailable. */
  export function diff(): DiffBinding | undefined {
    return loadAddon("@ax-code/diff", Flag.AX_CODE_NATIVE_DIFF) as DiffBinding | undefined
  }

  /** Returns the `@ax-code/index-core` binding or `undefined` if unavailable. */
  export function index(): IndexBinding | undefined {
    return loadAddon("@ax-code/index-core", Flag.AX_CODE_NATIVE_INDEX) as IndexBinding | undefined
  }

  /** Returns the `@ax-code/parser` binding or `undefined` if unavailable. */
  export function parser(): ParserBinding | undefined {
    return loadAddon("@ax-code/parser", Flag.AX_CODE_NATIVE_PARSER) as ParserBinding | undefined
  }
}
