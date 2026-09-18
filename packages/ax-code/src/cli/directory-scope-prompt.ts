import * as prompts from "@clack/prompts"
import { parse as parseJsonc, type ParseError as JsoncParseError } from "jsonc-parser"
import path from "path"
import { mergeDeep } from "remeda"
import { DirectoryScopeTrust } from "../config/directory-scope-trust"
import { DirectoryScope } from "../file/directory-scope"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

const log = Log.create({ service: "cli.directory-scope-prompt" })

interface DirectoryScopeSettings {
  enabled?: boolean
  maxTopLevelEntries?: number
  extraDenylist?: string[]
}

// This reads the raw config file directly rather than going through the
// full Config.get() schema validation (which requires an Instance context
// we don't have yet — see confirmDirectoryScope's doc comment), so a
// malformed value here must not translate into pathological behavior (e.g.
// a negative maxTopLevelEntries would make DirectoryScope.assess flag every
// directory as broad).
function sanitize(input: unknown): DirectoryScopeSettings {
  if (typeof input !== "object" || input === null) return {}
  const record = input as Record<string, unknown>
  const settings: DirectoryScopeSettings = {}
  if (typeof record.enabled === "boolean") settings.enabled = record.enabled
  if (typeof record.maxTopLevelEntries === "number" && Number.isInteger(record.maxTopLevelEntries)) {
    settings.maxTopLevelEntries = Math.max(1, record.maxTopLevelEntries)
  }
  if (Array.isArray(record.extraDenylist)) {
    settings.extraDenylist = record.extraDenylist.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
    )
  }
  return settings
}

// Runs before any Instance/session exists (see cli/tui/thread.ts and
// cli/cmd/run.ts), so only global user config is available here — not the
// project-level ax-code.json inside the (possibly wrong) target directory.
async function loadGlobalSettings(): Promise<DirectoryScopeSettings> {
  const files = ["config.json", "ax-code.json", "ax-code.jsonc"].map((name) => path.join(Global.Path.config, name))
  let settings: DirectoryScopeSettings = {}
  for (const file of files) {
    const text = await Filesystem.readText(file).catch((error) => {
      if (Filesystem.isEnoent(error)) return undefined
      log.warn("failed to read global config for directoryScope settings", { file, error })
      return undefined
    })
    if (text === undefined) continue
    const errors: JsoncParseError[] = []
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true }) as { directoryScope?: unknown } | undefined
    if (errors.length || !parsed || typeof parsed !== "object") {
      log.warn("failed to parse global config for directoryScope settings", { file })
      continue
    }
    if (parsed.directoryScope) settings = mergeDeep(settings, sanitize(parsed.directoryScope))
  }
  return settings
}

export interface DirectoryScopeGate {
  proceed: boolean
  /** Set only when proceed is false — pass straight to UI.error()/exitEarly(). */
  message?: string
}

/**
 * Pre-flight guard against launching ax-code in an accidentally broad
 * directory (home, Desktop, Downloads, Documents, a filesystem root, or a
 * very large top-level listing). Must run before any scanning/indexing
 * starts. In an interactive TTY it asks for confirmation and remembers the
 * answer (DirectoryScopeTrust); otherwise it refuses by default, since a
 * non-interactive/piped invocation is exactly when an accidental broad-
 * directory run is most likely and least supervised.
 */
export async function confirmDirectoryScope(dir: string): Promise<DirectoryScopeGate> {
  if (Flag.AX_CODE_ALLOW_BROAD_DIR) return { proceed: true }

  const settings = await loadGlobalSettings()
  if (settings.enabled === false) return { proceed: true }

  const resolved = Filesystem.resolve(dir)
  if (await DirectoryScopeTrust.isTrusted(resolved)) return { proceed: true }

  const { broad, reason } = await DirectoryScope.assess(resolved, {
    maxTopLevelEntries: settings.maxTopLevelEntries,
    extraDenylist: settings.extraDenylist,
  })
  if (!broad) return { proceed: true }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  if (!interactive) {
    return {
      proceed: false,
      message: `Refusing to start in ${resolved}: ${reason}. cd into your project directory, or set AX_CODE_ALLOW_BROAD_DIR=1 to proceed anyway.`,
    }
  }

  prompts.log.warn(
    `ax-code is starting in ${resolved} — ${reason}. Indexing this directory could be slow and use a lot of tokens.`,
  )
  const answer = await prompts.confirm({ message: "Continue anyway?", initialValue: false })
  if (prompts.isCancel(answer) || !answer) {
    return {
      proceed: false,
      message: `Aborted: ${resolved} — ${reason}. cd into your project directory and try again.`,
    }
  }

  await DirectoryScopeTrust.trust(resolved)
  return { proceed: true }
}
