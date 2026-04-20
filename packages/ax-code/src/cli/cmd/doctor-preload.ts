import path from "path"
import { Installation } from "../../installation"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

type TuiPreloadCheckInput = {
  bundled?: boolean
  importMetaDir?: string
  resolveSync?: (module: string, from?: string) => string
}

export function getTuiPreloadCheck(input: TuiPreloadCheckInput = {}): DoctorCheck {
  const bundled = input.bundled ?? !Installation.isLocal()
  if (bundled) {
    return {
      name: "TUI preload",
      status: "ok",
      detail: "Bundled runtime — OpenTUI preload is compiled into the standalone binary",
    }
  }

  try {
    const preloadPath = (input.resolveSync ?? Bun.resolveSync)(
      "@opentui/solid/preload",
      input.importMetaDir ?? import.meta.dir,
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
