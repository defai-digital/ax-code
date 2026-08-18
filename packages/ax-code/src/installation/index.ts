import path from "path"
import os from "os"
import fs from "fs/promises"
import { buffer } from "node:stream/consumers"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import {
  HOMEBREW_TAP,
  LEGACY_HOMEBREW_TAP,
  HOMEBREW_FORMULA_API_URL,
  INSTALL_SCRIPT_URL,
  INSTALL_PS1_SCRIPT_URL,
  GITHUB_LATEST_RELEASE_API_URL,
} from "@/constants/project"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Process } from "../util/process"
import { whichAll } from "../util/which"
import { parseJsonResult } from "../util/json-value"

declare global {
  const AX_CODE_VERSION: string
  const AX_CODE_CHANNEL: string
}

import semver from "semver"

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = "curl" | "brew" | "unknown"

  export type ReleaseType = "patch" | "minor" | "major" | "unknown"

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
        warnings: z.array(z.string()).optional(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export function compareVersions(current: string, latest: string) {
    if (!semver.valid(current) || !semver.valid(latest)) return undefined
    return semver.compare(latest, current)
  }

  export function getReleaseType(current: string, latest: string): ReleaseType {
    const compare = compareVersions(current, latest)
    if (compare === undefined) return "unknown"
    if (compare <= 0) return "unknown"

    const currMajor = semver.major(current)
    const currMinor = semver.minor(current)
    const newMajor = semver.major(latest)
    const newMinor = semver.minor(latest)

    if (newMajor > currMajor) return "major"
    if (newMinor > currMinor) return "minor"
    return "patch"
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  // Build-time version from AX_CODE_VERSION global, or read from package.json for dev mode
  export const VERSION = (() => {
    if (typeof AX_CODE_VERSION === "string") return AX_CODE_VERSION
    try {
      return require("../../package.json").version as string
    } catch {
      return "local"
    }
  })()
  export const CHANNEL = typeof AX_CODE_CHANNEL === "string" ? AX_CODE_CHANNEL : "local"
  export const USER_AGENT = `ax-code/${CHANNEL}/${VERSION}/${Flag.AX_CODE_CLIENT}`

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export class UpgradeFailedError extends Error {
    override readonly name = "UpgradeFailedError"

    constructor(readonly input: { stderr: string }) {
      super(input.stderr || "Upgrade failed")
      this.name = "UpgradeFailedError"
    }

    get stderr() {
      return this.input.stderr
    }
  }

  // Response schemas for external version APIs
  const GitHubRelease = z.object({ tag_name: z.string() })
  const BrewFormula = z.object({ versions: z.object({ stable: z.string() }) })
  const BrewInfoV2 = z.object({
    formulae: z.array(z.object({ versions: z.object({ stable: z.string() }) })),
  })

  interface CommandResult {
    code: number
    stdout: string
    stderr: string
  }

  interface RunOptions {
    cwd?: string
    env?: Record<string, string>
    input?: Uint8Array
  }

  interface Dependencies {
    fetch: typeof fetch
    run: (cmd: string[], opts?: RunOptions) => Promise<CommandResult>
    which: (cmd: string) => string[]
    // Injectable so the Windows installer branch can be exercised in tests
    // regardless of the host OS.
    platform: NodeJS.Platform
  }

  const defaultDependencies: Dependencies = {
    fetch: globalThis.fetch.bind(globalThis),
    run: runCommand,
    // extraDirs: false — the shadow-launcher check reports what the shell
    // would actually resolve, not ax-code's own fallback install locations.
    which: (cmd) => whichAll(cmd, undefined, { extraDirs: false }),
    platform: process.platform,
  }

  let dependencies = defaultDependencies

  export async function withDependencies<T>(next: Partial<Dependencies>, fn: () => Promise<T>): Promise<T> {
    const previous = dependencies
    dependencies = { ...dependencies, ...next }
    try {
      return await fn()
    } finally {
      dependencies = previous
    }
  }

  async function runCommand(cmd: string[], opts: RunOptions = {}): Promise<CommandResult> {
    const proc = Process.spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      stdin: opts.input ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    if (opts.input) proc.stdin?.end(opts.input)
    if (!proc.stdout || !proc.stderr) return { code: 1, stdout: "", stderr: "Process output not available" }
    const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    return {
      code,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    }
  }

  // Best-effort stdout capture for probe commands (brew list/info/--repo).
  // Returns whatever the command wrote to stdout regardless of exit code —
  // these tools write diagnostics to stderr, so a non-zero exit still leaves
  // stdout either empty or holding the data callers parse. Only a spawn
  // failure (e.g. the binary is missing) yields "".
  async function text(cmd: string[], opts?: RunOptions) {
    const out = await dependencies.run(cmd, opts).catch(() => ({ code: 1, stdout: "", stderr: "" }))
    return out.stdout
  }

  async function fetchOk(url: string, options?: RequestInit) {
    const response = await dependencies.fetch(url, options)
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    return response
  }

  // Parses external-command/HTTP output that is expected to be JSON but, in
  // practice, can come back empty or truncated (a failed `brew` invocation, a
  // rate-limited API response) — surfaces a recoverable, contextual error
  // instead of a raw "Unexpected end of JSON input" crash.
  function parseJson(raw: string, context: string): unknown {
    const parsed = parseJsonResult(raw)
    if (!parsed.ok) throw new Error(`Failed to parse ${context} as JSON${raw.trim() ? "" : " (empty output)"}`)
    return parsed.value
  }

  async function fetchJson<T>(schema: z.ZodType<T>, url: string) {
    const response = await fetchOk(url, { headers: { accept: "application/json" } })
    return schema.parse(parseJson(await response.text(), `response from ${url}`))
  }

  async function getBrewFormula() {
    // Prefer the consolidated tap, then probe the former product-specific tap
    // so existing installations remain upgradeable during the migration.
    const canonical = `${HOMEBREW_TAP}/ax-code`
    const legacyAxCode = `${LEGACY_HOMEBREW_TAP}/ax-code`
    const legacyAx = `${LEGACY_HOMEBREW_TAP}/ax`
    const tapAxCode = await text(["brew", "list", "--formula", canonical])
    if (tapAxCode.includes("ax-code")) return canonical
    const oldTapAxCode = await text(["brew", "list", "--formula", legacyAxCode])
    if (oldTapAxCode.includes("ax-code")) return legacyAxCode
    const oldTapAx = await text(["brew", "list", "--formula", legacyAx])
    if (oldTapAx.includes("ax")) return legacyAx
    const coreFormula = await text(["brew", "list", "--formula", "ax-code"])
    if (coreFormula.includes("ax-code")) return "ax-code"
    return canonical
  }

  // Fetches a remote installer script and verifies it against its optional
  // `.sha256` sidecar. A hash mismatch is a hard failure; a missing sidecar
  // only warns and proceeds so existing deployments without one keep working.
  async function fetchInstallerScript(scriptUrl: string) {
    const sha256Url = `${scriptUrl}.sha256`
    const response = await fetchOk(scriptUrl)
    // Preserve the response bytes exactly. Decoding to text and re-encoding
    // can strip a BOM or replace malformed UTF-8, invalidating a legitimate
    // sidecar (or hashing bytes different from those written to disk).
    const bodyBytes = new Uint8Array(await response.arrayBuffer())
    try {
      const sha256Res = await dependencies.fetch(sha256Url)
      if (!sha256Res.ok) {
        log.warn("install script .sha256 sidecar not found — skipping integrity check")
      } else {
        const expected = (await sha256Res.text()).trim().split(/\s+/)[0]
        if (!/^[a-f0-9]{64}$/i.test(expected)) {
          throw new Error("Install script integrity check failed: .sha256 sidecar does not contain a SHA-256 digest")
        }
        const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBytes)
        const actual = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        if (actual !== expected.toLowerCase())
          throw new Error(`Install script integrity check failed: expected ${expected}, got ${actual}`)
      }
    } catch (e) {
      const msg = toErrorMessage(e)
      if (msg.startsWith("Install script integrity check failed")) throw e
      log.warn("could not verify install script integrity", { error: e })
    }
    return bodyBytes
  }

  async function upgradeCurl(target: string) {
    if (dependencies.platform === "win32") return upgradeWindows(target)
    const bodyBytes = await fetchInstallerScript(INSTALL_SCRIPT_URL)
    return dependencies.run(["bash"], {
      input: bodyBytes,
      env: { VERSION: target },
    })
  }

  // Windows-native self-upgrade: download the PowerShell installer and run it
  // with Windows PowerShell. The installer minisign-verifies the release
  // archive itself against a pinned public key, matching the bash path.
  async function upgradeWindows(target: string) {
    const bodyBytes = await fetchInstallerScript(INSTALL_PS1_SCRIPT_URL)
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-upgrade-"))
    try {
      const scriptPath = path.join(dir, "install.ps1")
      await fs.writeFile(scriptPath, bodyBytes)
      return await dependencies.run([
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Version",
        target,
      ])
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  export async function info(): Promise<Info> {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export async function method(): Promise<Method> {
    if (process.execPath.includes(path.join(".ax-code", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"

    for (const formula of [
      `${HOMEBREW_TAP}/ax-code`,
      `${LEGACY_HOMEBREW_TAP}/ax-code`,
      `${LEGACY_HOMEBREW_TAP}/ax`,
      "ax-code",
    ]) {
      const out = await text(["brew", "list", "--formula", formula])
      if (out.trim()) return "brew"
    }

    return "unknown"
  }

  export async function latest(installMethod?: Method): Promise<string> {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula.includes("/")) {
        const infoJson = await text(["brew", "info", "--json=v2", formula])
        const info = BrewInfoV2.parse(parseJson(infoJson, `'brew info --json=v2 ${formula}' output`))
        if (!info.formulae.length) return "unknown"
        return info.formulae[0].versions.stable
      }
      const data = await fetchJson(BrewFormula, HOMEBREW_FORMULA_API_URL)
      return data.versions.stable
    }

    const data = await fetchJson(GitHubRelease, GITHUB_LATEST_RELEASE_API_URL)
    return data.tag_name.replace(/^v/, "")
  }

  export async function upgrade(m: Method, target: string): Promise<void> {
    let result: CommandResult | undefined
    switch (m) {
      case "curl":
        result = await upgradeCurl(target)
        break
      case "brew": {
        const formula = await getBrewFormula()
        const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
        if (formula.includes("/")) {
          const tapName = formula.split("/").slice(0, 2).join("/")
          const tap = await dependencies.run(["brew", "tap", tapName], { env })
          if (tap.code !== 0) {
            result = tap
            break
          }
          const repo = await text(["brew", "--repo", tapName])
          const dir = repo.trim()
          if (dir) {
            const pull = await dependencies.run(["git", "pull", "--ff-only"], { cwd: dir, env })
            if (pull.code !== 0) {
              result = pull
              break
            }
          }
        }
        result = await dependencies.run(["brew", "upgrade", formula], { env })
        // Homebrew refuses to link a formula while an installed cask shares
        // its token (the deprecated "ax-code" Desktop cask), and upgrade
        // cleanup then removes the previously linked keg — leaving no ax-code
        // on PATH at all. Relinking is the documented manual fix and is safe:
        // brew link aborts on real file conflicts instead of overwriting.
        if (result.code === 0 && (result.stdout + result.stderr).includes("cask is installed, skipping link")) {
          const link = await dependencies.run(["brew", "link", formula], { env })
          if (link.code === 0) {
            log.info("relinked formula after cask-induced skip-link", { command: "brew link", status: "ok" })
          } else {
            log.warn("brew link failed after cask-induced skip-link", {
              command: "brew link",
              status: "error",
              stderr: link.stderr,
            })
          }
        }
        break
      }
      case "unknown":
        // Fallback to curl installer script when method can't be detected —
        // works regardless of install location (legacy npm global, manual copy, etc.)
        result = await upgradeCurl(target)
        break
      default:
        throw new UpgradeFailedError({ stderr: `Unknown method: ${m}` })
    }
    if (!result || result.code !== 0) {
      const stderr = result?.stderr || ""
      throw new UpgradeFailedError({ stderr })
    }
    log.info("upgraded", {
      method: m,
      target,
      stdout: result.stdout,
      stderr: result.stderr,
    })
    await text([process.execPath, "--version"])
  }

  export interface LauncherCheck {
    // False when a different "ax-code" earlier on PATH would run instead of
    // (or reports a different version than) the one just upgraded — e.g. a
    // Homebrew upgrade succeeding while a stale ~/.local/bin/ax-code shadows
    // it — or when no launcher is resolvable at all (empty `launchers`), e.g.
    // Homebrew skipping the formula link because a same-token cask is
    // installed and cleanup removing the previously linked keg.
    ok: boolean
    launchers: string[]
    activePath?: string
    activeVersion?: string
  }

  export function launcherWarnings(target: string, launcher: LauncherCheck): string[] {
    if (launcher.ok) return []
    if (!launcher.activePath) {
      return [
        "No `ax-code` launcher found on PATH after the upgrade — restart your shell or check that the install directory is still on PATH.",
      ]
    }
    return [
      launcher.activeVersion
        ? `PATH resolves \`ax-code\` to ${launcher.activePath} (v${launcher.activeVersion}) — running \`ax-code\` will keep using that version until the stale launcher is removed or PATH is fixed.`
        : `PATH resolves \`ax-code\` to ${launcher.activePath}, whose version could not be determined — it may not be v${target}.`,
    ]
  }

  export async function verifyActiveLauncher(target: string, binName = "ax-code"): Promise<LauncherCheck> {
    const launchers = dependencies.which(binName)
    const activePath = launchers[0]
    if (!activePath) return { ok: false, launchers }
    const activeVersion = (await text([activePath, "--version"])).trim() || undefined
    return { ok: activeVersion === target, launchers, activePath, activeVersion }
  }
}
