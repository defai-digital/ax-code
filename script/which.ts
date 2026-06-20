import fs from "node:fs"
import path from "node:path"

// Locate an executable on PATH, replacing Bun.which so scripts run under
// Node/tsx. Returns the absolute path or null, like Bun.which.
export function whichSync(command: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}
