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
import { lazy } from "../util/lazy"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

const log = Log.create({ service: "native.addon" })
const _require = createRequire(import.meta.url)

function loadAddon(pkg: string, enabled: boolean): any | undefined {
  if (!enabled) return undefined
  try {
    return _require(pkg)
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load native addon", { pkg, error: e })
    }
    return undefined
  }
}

const fsAddon = lazy(() => loadAddon("@ax-code/fs", Flag.AX_CODE_NATIVE_FS))
const diffAddon = lazy(() => loadAddon("@ax-code/diff", Flag.AX_CODE_NATIVE_DIFF))
const indexAddon = lazy(() => loadAddon("@ax-code/index-core", Flag.AX_CODE_NATIVE_INDEX))
const parserAddon = lazy(() => loadAddon("@ax-code/parser", Flag.AX_CODE_NATIVE_PARSER))

export namespace NativeAddon {
  /** Returns the `@ax-code/fs` binding or `undefined` if unavailable. */
  export function fs(): any | undefined {
    return fsAddon()
  }

  /** Returns the `@ax-code/diff` binding or `undefined` if unavailable. */
  export function diff(): any | undefined {
    return diffAddon()
  }

  /** Returns the `@ax-code/index-core` binding or `undefined` if unavailable. */
  export function index(): any | undefined {
    return indexAddon()
  }

  /** Returns the `@ax-code/parser` binding or `undefined` if unavailable. */
  export function parser(): any | undefined {
    return parserAddon()
  }
}
