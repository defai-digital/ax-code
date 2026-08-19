import fs from "node:fs"
import path from "node:path"

function executableCandidates(command: string) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  const found: string[] = []
  const seen = new Set<string>()
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      if (seen.has(candidate) || !fs.existsSync(candidate)) continue
      seen.add(candidate)
      found.push(candidate)
    }
  }
  return found
}

// Locate an executable on PATH, replacing Bun.which so scripts run under
// Node/tsx. Returns the absolute path or null, like Bun.which.
export function whichSync(command: string): string | null {
  return executableCandidates(command)[0] ?? null
}

// Every PATH match for `command`, in resolution order. Used to detect a
// checkout launcher that shadows a later Homebrew install.
export function whichAllSync(command: string): string[] {
  return executableCandidates(command)
}
