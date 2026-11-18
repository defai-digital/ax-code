import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { parseJsonPayload } from "@/util/json-value"
import { isRecord } from "@/util/record"
import { Configuration } from "./webmcp-config"

export const PACKAGE = "chrome-devtools-mcp@1.10.1"

type Server = {
  type: string
  command?: string[]
  enabled?: boolean
  environment?: Record<string, string>
  webmcp?: Configuration
}

function profileDirectory(profile: Configuration): string {
  const key = createHash("sha256").update(profile.allowedOrigins.join("\n")).digest("hex").slice(0, 16)
  return path.join(os.homedir(), ".ax-code", "webmcp-profiles", key)
}

export const VENDORED_PACKAGE = PACKAGE

// Pinned integrity of chrome-devtools-mcp@1.10.1, the exact reviewed package
// (ADR-195; registry tarball 2026-09-23, no runtime dependencies).
export const VENDORED_INTEGRITY =
  "sha512-Klw6HWDqHC/XS1JwZldd2r49aUhbUJN9m9Mvcx4SEueIPXtzuQX+QelxAViobv8YUkDZ7HWDrmViR6LeYK0wAw=="

export const VENDORED_VERSION = "1.10.1"

export const VENDORED_REGISTRY_HOST = "registry.npmjs.org"

export function vendoredDir(): string {
  return path.join(os.homedir(), ".ax-code", "vendor", `chrome-devtools-mcp-${PACKAGE.split("@")[1]}`)
}

export function vendoredBin(): string {
  return path.join(
    vendoredDir(),
    "node_modules",
    "chrome-devtools-mcp",
    "build",
    "src",
    "bin",
    "chrome-devtools-mcp.js",
  )
}

/** Verify the installed package's lockfile integrity against the reviewed pin. */
export function verifyLockfileIntegrity(lockfile: string): { ok: true } | { ok: false; error: string } {
  const parsed = parseJsonPayload(lockfile)
  if (!isRecord(parsed)) {
    return { ok: false, error: "WebMCP vendored lockfile is not valid JSON" }
  }
  const packages = isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : {}
  const entry = isRecord(packages["node_modules/chrome-devtools-mcp"])
    ? (packages["node_modules/chrome-devtools-mcp"] as Record<string, unknown>)
    : undefined
  if (entry?.integrity !== VENDORED_INTEGRITY) {
    return { ok: false, error: "WebMCP vendored install integrity does not match the reviewed pin" }
  }
  // The integrity pin alone does not bind the version or the registry it
  // was resolved from; a lockfile that points elsewhere fails closed.
  if (entry.version !== VENDORED_VERSION) {
    return { ok: false, error: "WebMCP vendored install version does not match the reviewed pin" }
  }
  let resolved: URL | undefined
  try {
    resolved = typeof entry.resolved === "string" ? new URL(entry.resolved) : undefined
  } catch {
    resolved = undefined
  }
  if (resolved?.protocol !== "https:" || resolved.hostname !== VENDORED_REGISTRY_HOST) {
    return { ok: false, error: "WebMCP vendored install was not resolved from the pinned registry" }
  }
  return { ok: true }
}

// Rollup over every reviewed byte of chrome-devtools-mcp@1.10.1 (359 files): the sha512
// of the sorted `path:file-sha512` lines of the integrity-pinned tarball,
// verified byte-identical against a real registry install.
export const VENDORED_PACKAGE_HASH =
  "a3ecff526f62558b03439af3a24e5644aad7948083a49c7ccf0415d47a60757d621e4f0250e1efdd5b0ef43eca12aebac26eb25e9b520dcb93c8088e3839a3e5"

/**
 * Verify the installed package bytes against the reviewed rollup. The
 * lockfile pins are public claims — anyone can write a matching lockfile —
 * so every launch re-hashes the extracted files. Dotfiles are skipped (OS
 * droppings, never required); anything else unexpected, missing, unreadable
 * or symlinked fails closed. Hoisted dependency siblings are outside this
 * check: they are fetched over the pinned https registry at install time
 * and are not re-verified here.
 */
export function verifyVendoredPackage(
  prefixDir: string,
  expected = VENDORED_PACKAGE_HASH,
): { ok: true } | { ok: false; error: string } {
  const root = path.join(prefixDir, "node_modules", "chrome-devtools-mcp")
  const failed = { ok: false as const, error: "WebMCP vendored install failed byte verification" }
  const files: string[] = []
  const walk = (dir: string): boolean => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) return false
      if (entry.isDirectory()) {
        if (!walk(full)) return false
      } else {
        files.push(path.relative(root, full).split(path.sep).join("/"))
      }
    }
    return true
  }
  if (!walk(root)) return failed
  files.sort()
  const rollup = createHash("sha512")
  for (const rel of files) {
    let bytes: Buffer
    try {
      bytes = readFileSync(path.join(root, rel))
    } catch {
      return failed
    }
    rollup.update(`${rel}:${createHash("sha512").update(bytes).digest("hex")}\n`)
  }
  if (rollup.digest("hex") !== expected) return failed
  return { ok: true }
}

export function command(profile: Configuration, identity?: Configuration): string[] {
  return [
    // A vendored profile launches the integrity-pinned local install; the
    // default npx form resolves the same pinned version from the registry.
    ...(profile.vendored ? ["node", vendoredBin()] : ["npx", "-y", PACKAGE]),
    // A persistent profile holds real cookies, so it is always a dedicated
    // AX-owned directory with a visible window — never the user's main
    // profile and never headless. The directory key follows the configured
    // profile (identity), not the effective one: session grants and managed
    // narrowing change the launch argv but must not swap the login state out
    // from under the user.
    ...(profile.persistentProfile
      ? [`--user-data-dir=${profileDirectory(identity ?? profile)}`]
      : ["--isolated", ...(profile.headless ? ["--headless"] : [])]),
    "--no-usage-statistics",
    // The upstream allowlist keeps only ordinary headers; consumer result
    // sanitization adds defence in depth.
    "--redactNetworkHeaders",
    "--no-performance-crux",
    // ADR-172 took the network flag off, ADR-193 takes the emulation flag
    // off because the viewport presets use emulate; its schema admits only the
    // preset viewport strings, resize_page stays rejected by allows(), and the
    // performance flag stays as defence in depth.
    "--no-category-performance",
    // ADR-195: the pinned 1.10.1 build can switch JavaScript execution off
    // entirely: evaluate_script is disabled, navigate_page loses initScript and
    // javascript:/data:/vbscript: navigations are refused upstream. allows()
    // already rejects all of it; this makes the bridge itself refuse too.
    "--no-javascript-evaluation",
    "--category-experimental-webmcp",
    "--experimental-structured-content",
    // The pinned upstream downscales a capture that exceeds either bound (aspect
    // ratio preserved), which keeps Retina viewport captures under the upstream
    // 2 MB auto-save threshold that `boundReadResult` fails closed on.
    "--screenshot-max-width=1600",
    "--screenshot-max-height=1600",
    "--chrome-arg=--enable-features=WebMCP",
    ...(profile.executablePath ? [`--executable-path=${profile.executablePath}`] : []),
    ...profile.allowedOrigins.map((origin) => {
      const url = new URL(origin)
      // URLPattern treats IPv6 colons as parameter syntax unless escaped.
      const hostname = url.hostname.replaceAll(":", "\\:")
      return `--allowed-url-pattern=${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}/*`
    }),
  ]
}

export function config(
  input: Configuration,
  enabled = false,
): Server & { type: "local"; command: string[]; enabled: boolean; webmcp: Configuration } {
  const profile = Configuration.parse(input)
  return { type: "local", command: command(profile), enabled, webmcp: profile }
}

export function disabled(server: Server): boolean {
  return server.enabled === false || (server.webmcp !== undefined && server.enabled !== true)
}

/**
 * Validate a configured webmcp entry and return its frozen profile. The
 * stored command is never executed (ADR-173): the launch argv is always
 * regenerated from the effective profile at connect time, so version drift
 * self-heals and a hand-edited command cannot smuggle arguments — it is
 * discarded by construction. Semantics stay exactly f(profile): the schema
 * and the managed gates validate the profile, not the command.
 */
export function validateLaunch(server: Server): Configuration | undefined {
  if (!server.webmcp) return undefined
  const profile = Configuration.parse(server.webmcp)
  if (server.type !== "local") {
    throw new Error("WebMCP requires a local launch command")
  }
  if (server.environment && Object.keys(server.environment).length > 0) {
    throw new Error("WebMCP profiles do not accept environment overrides.")
  }
  Object.freeze(profile.allowedOrigins)
  return Object.freeze(profile)
}

/**
 * Why a webmcp-profiled entry cannot skip the config-source trust gate on an
 * explicit connect, or undefined when it can (ADR-197). The stored command is
 * never executed (ADR-173), so it plays no part: an entry written by another
 * ax-code version connects on the gesture. What the gesture cannot vouch for
 * is a launch option that reaches past the regenerated argv: a custom Chrome
 * executable is run as-is (version preflight, then the browser), a persistent
 * profile holds real cookies, and a vendored install runs from a local cache.
 * Those need an explicit trust grant from an untrusted source.
 */
export function trustGateReason(server: Server): string | undefined {
  if (server.type !== "local" || server.webmcp === undefined) return undefined
  let profile: Configuration | undefined
  try {
    profile = validateLaunch(server)
  } catch (error) {
    return `webmcp profile is invalid: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!profile) return undefined
  const options = [
    ...(profile.executablePath ? ["executablePath"] : []),
    ...(profile.persistentProfile ? ["persistentProfile"] : []),
    ...(profile.vendored ? ["vendored"] : []),
  ]
  if (options.length === 0) return undefined
  return `webmcp profile sets ${options.join(", ")}; an untrusted config source needs an explicit MCP trust grant`
}

/**
 * How a webmcp-profiled entry's stored command differs from the reviewed
 * launch argv for its validated profile, or undefined when it matches. The
 * stored command is ignored either way (ADR-173); this only names the drift
 * for diagnostics.
 */
export function argvMismatch(server: Server): string | undefined {
  if (server.type !== "local" || server.webmcp === undefined) return undefined
  let profile: Configuration | undefined
  try {
    profile = validateLaunch(server)
  } catch (error) {
    return `webmcp profile is invalid: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!profile) return undefined
  const expected = command(profile)
  if (JSON.stringify(server.command) === JSON.stringify(expected)) return undefined
  const actual = server.command ?? []
  const extra = actual.filter((arg) => !expected.includes(arg))
  const missing = expected.filter((arg) => !actual.includes(arg))
  const parts = [
    ...(extra.length > 0 ? [`extra ${extra.join(" ")}`] : []),
    ...(missing.length > 0 ? [`missing ${missing.join(" ")}`] : []),
  ]
  const detail = parts.length > 0 ? parts.join("; ") : "argument order differs"
  return `command differs from its webmcp profile (${detail})`
}

export const MIN_CHROME_MAJOR = 150

const CHROME_VERSION = /^(?:Google Chrome(?: for Testing)?|Chromium)\s+(\d+)\./

/** Parse the major version from `chrome --version` output. */
export function chromeMajor(version: string): number | undefined {
  // Any `digits-dot` prefix is not a Chrome version: another product's
  // output (or an unparseable number) must not pass the version floor.
  const match = CHROME_VERSION.exec(version.trim())
  if (!match) return undefined
  const major = Number(match[1])
  return Number.isSafeInteger(major) ? major : undefined
}

const execFileAsync = promisify(execFile)

/**
 * Fail-closed preflight for an explicit Chrome executable. The pinned bridge
 * needs Chrome 150+ for the WebMCP surface; a stale or non-Chrome binary must
 * be rejected before a browser is launched. Best-effort by nature: the binary
 * could still be swapped between this check and the bridge launch, so this
 * only rejects stale or non-Chrome binaries, it does not authenticate them.
 */
export async function verifyChromeVersion(
  executablePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let output: string
  try {
    // Async so a hung executable cannot stall the event loop, with SIGKILL
    // so a binary that ignores SIGTERM cannot leave the preflight pending
    // forever; the timeout then bounds the wait.
    ;({ stdout: output } = await execFileAsync(executablePath, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      killSignal: "SIGKILL",
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Could not run the configured Chrome executable: ${message}` }
  }
  const major = chromeMajor(output)
  if (major === undefined) {
    return { ok: false, error: "Could not read the Chrome version from the configured executable" }
  }
  if (major < MIN_CHROME_MAJOR) {
    return { ok: false, error: `WebMCP requires Chrome ${MIN_CHROME_MAJOR}+ (configured executable is ${major})` }
  }
  return { ok: true }
}
