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

const log = Log.create({ service: "native.addon" })
const _require = createRequire(import.meta.url)

// Cache by package name. We cache the resolved binding (or the MODULE_NOT_FOUND
// outcome) so we don't pay the require cost on every accessor call. The flag
// itself is re-read on every call, so flipping AX_CODE_NATIVE_* at runtime
// (test harnesses, embedders mutating process.env) takes effect immediately.
type CacheEntry = { value: any | undefined }
const cache = new Map<string, CacheEntry>()

function loadAddon(pkg: string, enabled: boolean): any | undefined {
  if (!enabled) return undefined
  const cached = cache.get(pkg)
  if (cached) return cached.value
  let value: any | undefined
  try {
    value = _require(pkg)
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load native addon", { pkg, error: e })
    }
    value = undefined
  }
  cache.set(pkg, { value })
  return value
}

export namespace NativeAddon {
  /** Returns the `@ax-code/fs` binding or `undefined` if unavailable. */
  export function fs(): any | undefined {
    return loadAddon("@ax-code/fs", Flag.AX_CODE_NATIVE_FS)
  }

  /** Returns the `@ax-code/diff` binding or `undefined` if unavailable. */
  export function diff(): any | undefined {
    return loadAddon("@ax-code/diff", Flag.AX_CODE_NATIVE_DIFF)
  }

  /** Returns the `@ax-code/index-core` binding or `undefined` if unavailable. */
  export function index(): any | undefined {
    return loadAddon("@ax-code/index-core", Flag.AX_CODE_NATIVE_INDEX)
  }

  /** Returns the `@ax-code/parser` binding or `undefined` if unavailable. */
  export function parser(): any | undefined {
    return loadAddon("@ax-code/parser", Flag.AX_CODE_NATIVE_PARSER)
  }
}
