import { EOL } from "os"
import type { Argv } from "yargs"

export function jsonOption() {
  return {
    type: "boolean" as const,
    describe: "output machine-readable JSON",
  }
}

export function writeJson(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + EOL)
}

/** Use the active parser schema, never raw argv or positional prompt text. */
export function writeJsonUsageError(parsed: Argv["parsed"], message: string | undefined): boolean {
  if (!message || !parsed || !Object.hasOwn(parsed.aliases, "json") || parsed.argv.json !== true) return false
  process.stderr.write(JSON.stringify({ error: { code: "usage", message } }) + EOL)
  return true
}
