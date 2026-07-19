import { Glob } from "../util/glob"
import { NativePerf } from "../perf/native"
import { Log } from "../util/log"
import { NativeAddon } from "../native/addon"
// Single source of truth for JS + Rust (see crates/ax-code-fs + ignore-drift test).
import ignorePatterns from "./ignore-patterns.json"

export namespace FileIgnore {
  const FOLDERS = new Set(ignorePatterns.folders as readonly string[])
  const FILES = ignorePatterns.files as readonly string[]

  /** Exported for drift tests / native parity checks. */
  export const FOLDER_NAMES = ignorePatterns.folders as readonly string[]
  export const FILE_PATTERNS = FILES

  export const PATTERNS = [...FILES, ...FOLDERS]

  export function match(
    filepath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    for (const pattern of opts?.whitelist || []) {
      if (Glob.match(pattern, filepath)) return false
    }

    // Native fast-path: in-process ignore check via Rust addon
    const native = NativeAddon.fs()
    if (native) {
      try {
        return NativePerf.run("fs.isIgnored", { filepath, extra: opts?.extra?.length ?? 0 }, () =>
          native.isIgnored(filepath, JSON.stringify(opts?.extra ?? [])),
        )
      } catch (e) {
        Log.Default.warn("native FS addon failed, falling back to JS", { err: e })
      }
    }

    for (const pattern of opts?.whitelist || []) {
      if (Glob.match(pattern, filepath)) return false
    }

    const parts = filepath.split(/[/\\]/)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
    }

    const extra = opts?.extra || []
    for (const pattern of [...FILES, ...extra]) {
      if (Glob.match(pattern, filepath)) return true
    }

    return false
  }
}
