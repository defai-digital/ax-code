import { createRequire } from "node:module"
import { lazy } from "@/util/lazy"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

const log = Log.create({ service: "native.addon" })
const _require = createRequire(import.meta.url)

const fsAddon = lazy((): any | undefined => {
  if (!Flag.AX_CODE_NATIVE_FS) return undefined
  try {
    return _require("@ax-code/fs")
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load @ax-code/fs native addon", { error: e })
    }
    return undefined
  }
})

const diffAddon = lazy((): any | undefined => {
  if (!Flag.AX_CODE_NATIVE_DIFF) return undefined
  try {
    return _require("@ax-code/diff")
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load @ax-code/diff native addon", { error: e })
    }
    return undefined
  }
})

const indexAddon = lazy((): any | undefined => {
  if (!Flag.AX_CODE_NATIVE_INDEX) return undefined
  try {
    return _require("@ax-code/index-core")
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND") {
      log.warn("failed to load @ax-code/index-core native addon", { error: e })
    }
    return undefined
  }
})

export namespace NativeAddon {
  /** Returns the @ax-code/fs binding or undefined if unavailable. */
  export function fs(): any | undefined {
    return fsAddon()
  }

  /** Returns the @ax-code/diff binding or undefined if unavailable. */
  export function diff(): any | undefined {
    return diffAddon()
  }

  /** Returns the @ax-code/index-core binding or undefined if unavailable. */
  export function index(): any | undefined {
    return indexAddon()
  }
}
