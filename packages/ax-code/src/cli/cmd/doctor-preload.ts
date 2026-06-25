import path from "path"
import { createRequire } from "module"
import { Installation } from "../../installation"
import { runtimeMode, type RuntimeMode } from "../../installation/runtime-mode"
import { resolveSync } from "../../bun/node-compat"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

type TuiPreloadCheckInput = {
  bundled?: boolean
  importMetaDir?: string
  resolveSync?: (module: string, from?: string) => string
  runtimeMode?: RuntimeMode
  ffiAvailable?: boolean
}

// OpenTUI's Node renderer uses the experimental node:ffi module (Node 26+),
// gated behind the --experimental-ffi flag. The launcher passes it; detect
// whether it is actually active so doctor reports the TUI state accurately.
function nodeFfiAvailable(): boolean {
  try {
    createRequire(import.meta.url)("node:ffi")
    return true
  } catch {
    return false
  }
}

export function getTuiPreloadCheck(input: TuiPreloadCheckInput = {}): DoctorCheck {
  if ((input.runtimeMode ?? runtimeMode()) === "node-bundled") {
    const ffi = input.ffiAvailable ?? nodeFfiAvailable()
    if (ffi) {
      return {
        name: "TUI preload",
        status: "ok",
        detail: "Node runtime — OpenTUI renders via node:ffi; JSX transformed at build time",
      }
    }
    return {
      name: "TUI preload",
      status: "warn",
      detail:
        "Node runtime without node:ffi — run node with --experimental-ffi for the interactive TUI (diagnostic/headless otherwise)",
    }
  }

  const bundled = input.bundled ?? !Installation.isLocal()
  if (bundled) {
    return {
      name: "TUI preload",
      status: "ok",
      detail: "Bundled runtime — OpenTUI JSX is transformed at build time",
    }
  }

  try {
    const resolveFn = input.resolveSync ?? resolveSync
    const preloadPath = resolveFn(
      "@opentui/solid/preload",
      input.importMetaDir ?? import.meta.dirname,
    )
    return {
      name: "TUI preload",
      status: "ok",
      detail: `@opentui/solid/preload resolved (${path.basename(path.dirname(preloadPath))})`,
    }
  } catch {
    return {
      name: "TUI preload",
      status: "fail",
      detail: "@opentui/solid/preload not found — source/dev TUI may fail to start. Run: pnpm install",
    }
  }
}
