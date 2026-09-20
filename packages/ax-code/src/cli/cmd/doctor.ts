/**
 * Doctor command — system health check
 * Ported from ax-cli's doctor command
 *
 * Validates configuration, providers, tools, and environment
 */

import { Config } from "../../config/config"
import { cmd } from "./cmd"
import { Installation } from "../../installation"
import { runtimeMode } from "../../installation/runtime-mode"
import { Global } from "../../global"
import { Flag } from "../../flag/flag"
import { Auth } from "../../auth"
import { ModelsDev } from "../../provider/models"
import { Log } from "../../util/log"
import { Filesystem } from "../../util/filesystem"
import { NativeAddon } from "../../native/addon"
import { evidenceCacheMode } from "../../evidence/mode"
import { Database } from "../../storage/db"
import { getDoctorConfiguration, getConfiguredCredentialProviders } from "./doctor-config"
import { Locale } from "@/util/locale"
import { getTuiPreloadCheck } from "./doctor-preload"
import { getDoctorDatabaseCheck } from "./doctor-storage"
import { getRecentLogsChecks, getRunningInstancesCheck } from "./doctor-health"
import { getComputerUseCheck } from "./doctor-computer"
import path from "path"
import { realpathSync } from "fs"
import { access } from "fs/promises"
import { ProjectIdentity } from "../../project/project-identity"
import { isLoopbackHostname } from "../../runtime/listen-security"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import type { Isolation as IsolationConfig } from "../../config/schema"
import { Isolation } from "../../isolation"
import { toErrorMessage } from "@/util/error-message"
import { isPlausiblySupportedHost } from "@/provider/ax-engine/platform"
import { getAxEngineStatus } from "@/provider/ax-engine/status"
import { whichAll } from "../../util/which"
import { Process } from "../../util/process"

type DoctorCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string }

export function getEvidenceCacheCheck(
  mode = evidenceCacheMode(),
  nativeAvailable = mode === "rocksdb" && typeof NativeAddon.fs()?.openEvidenceStore === "function",
): DoctorCheck {
  if (mode !== "rocksdb")
    return { name: "Evidence cache", status: "ok", detail: mode === "off" ? "Disabled (off)" : "Memory only" }
  return {
    name: "Evidence cache",
    status: nativeAvailable ? "ok" : "warn",
    detail: nativeAvailable
      ? "RocksDB preferred; native available. Project lock or I/O failures fall back to memory."
      : "RocksDB preferred; native unavailable, using memory fallback. Rebuild or update the runtime.",
  }
}

export function getRuntimeCheck(): DoctorCheck {
  return {
    name: "Runtime",
    status: "ok",
    // Name the engine by the actual runtime, not the packaging mode: only real
    // Bun sets `process.versions.bun` (the Node compat shim deliberately does
    // not), so node-source/source runs report Node, not a shimmed `Bun.version`
    // that is really the Node version.
    detail: process.versions.bun
      ? `Bun ${process.versions.bun} (${runtimeMode()})`
      : `Node ${process.version} (${runtimeMode()})`,
  }
}

export function isHomebrewManagedPath(
  binaryPath: string,
  realpath: (p: string) => string = (p) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  },
): boolean {
  return realpath(binaryPath).includes(`${path.sep}Cellar${path.sep}`)
}

function describeLauncher(entry: { path: string; version?: string; homebrew: boolean }) {
  const version = entry.version ? ` (v${entry.version})` : ""
  const brew = entry.homebrew ? " [Homebrew]" : ""
  return `${entry.path}${version}${brew}`
}

export async function getPathLauncherCheck(
  input: {
    whichAll?: (cmd: string) => string[]
    versionOf?: (bin: string) => Promise<string | undefined>
    isHomebrew?: (bin: string) => boolean
  } = {},
): Promise<DoctorCheck | undefined> {
  const launchers = (input.whichAll ?? ((cmd: string) => whichAll(cmd, undefined, { extraDirs: false })))("ax-code")
  if (launchers.length < 2) return

  const versionOf =
    input.versionOf ??
    (async (bin: string) => {
      try {
        const result = await Process.run([bin, "--version"], { timeout: 5_000, nothrow: true })
        return result.stdout.toString().trim() || undefined
      } catch {
        return undefined
      }
    })
  const isHomebrew = input.isHomebrew ?? ((bin: string) => isHomebrewManagedPath(bin))

  const entries = []
  for (const launcher of launchers) {
    entries.push({
      path: launcher,
      version: await versionOf(launcher),
      homebrew: isHomebrew(launcher),
    })
  }

  const [first, ...others] = entries
  if (!first) return

  const brewLater = others.filter((entry) => entry.homebrew)
  const versionConflict = others.some((entry) => entry.version && first.version && entry.version !== first.version)
  if (!brewLater.length && !versionConflict) return

  return {
    name: "PATH launchers",
    status: "warn",
    detail:
      `${describeLauncher(first)} is first on PATH and shadows ${others.map(describeLauncher).join(", ")}. ` +
      "`brew upgrade ax-code` will not change the ax-code command until this launcher is moved aside " +
      `(mv ${first.path} ${first.path}.bak; hash -r).`,
  }
}

export function getServerExposureCheck(input: { hostname?: string; mdns?: boolean; password?: string }): DoctorCheck {
  const requestedHostname = input.hostname ?? (input.mdns ? "0.0.0.0" : "127.0.0.1")
  const loopbackOnly = isLoopbackHostname(requestedHostname)
  const hostname = loopbackOnly ? requestedHostname : "127.0.0.1"
  const authConfigured = !!input.password
  return {
    name: "Server exposure",
    status: "ok",
    detail: loopbackOnly
      ? `hostname ${hostname}; loopback-only; auth ${authConfigured ? "configured" : "not configured"}`
      : `requested hostname ${requestedHostname} and mDNS are ignored; effective hostname ${hostname}; local-only policy enforced`,
  }
}

export function getIsolationPolicyCheck(input: {
  config?: IsolationConfig
  envMode?: Isolation.Mode
  envNetwork?: boolean
}): DoctorCheck {
  const mode = input.envMode ?? input.config?.mode ?? Isolation.DEFAULT_MODE
  const modeSource = input.envMode ? "env" : input.config?.mode ? "config" : "default"
  const network =
    mode === "full-access" ? true : input.envNetwork !== undefined ? input.envNetwork : (input.config?.network ?? false)
  const networkSource =
    mode === "full-access"
      ? "full-access"
      : input.envNetwork !== undefined
        ? "env"
        : input.config
          ? "config"
          : "default"
  const detail = `mode ${mode} (${modeSource}); network ${network ? "enabled" : "disabled"} (${networkSource})`
  return {
    name: "Isolation policy",
    status: "ok",
    detail,
  }
}

// NATIVE_* feature flags mean "use the native addon if available". When the
// flag is on but the addon failed to load, annotate the flag so the
// "Feature flags" line stays consistent with the "Native addons" check.
export function formatNativeFlag(name: string, addonLoaded: boolean): string {
  return addonLoaded ? `${name}=on` : `${name}=on (addon missing — using TS fallback)`
}

const NATIVE_ADDON_NAMES = ["index-core", "fs", "diff", "parser"] as const

export function getNativeAddonsCheck(loaded: ReadonlyMap<string, boolean>): DoctorCheck {
  const installed = NATIVE_ADDON_NAMES.filter((name) => loaded.get(name))
  const missing = NATIVE_ADDON_NAMES.filter((name) => !loaded.get(name))
  if (missing.length === 0) {
    return {
      name: "Native addons",
      status: "ok",
      detail: `${installed.length}/${NATIVE_ADDON_NAMES.length} installed (${installed.join(", ")})`,
    }
  }
  if (installed.length === 0) {
    return {
      name: "Native addons",
      status: "warn",
      detail:
        'None installed — using TypeScript fallbacks (run "pnpm build:native" at the repo root, or reinstall the runtime, for faster indexing/search)',
    }
  }
  return {
    name: "Native addons",
    status: "warn",
    detail: `${installed.length}/${NATIVE_ADDON_NAMES.length} installed (${installed.join(", ")}); missing ${missing.join(", ")} — using TypeScript fallbacks. Rebuild native addons or reinstall the runtime.`,
  }
}

export function getFeatureFlagsCheck(flags: string[]): DoctorCheck | undefined {
  if (flags.length === 0) return undefined
  const missingAddon = flags.some((flag) => flag.includes("addon missing"))
  return {
    name: "Feature flags",
    status: missingAddon ? "warn" : "ok",
    detail: flags.join(", "),
  }
}

export function getAxEngineDoctorCheck(status: Awaited<ReturnType<typeof getAxEngineStatus>>): DoctorCheck {
  const configuredOrPrepared = status.model.present || status.server.running || status.dependency.available
  const relevant = isPlausiblySupportedHost() || configuredOrPrepared
  if (!relevant) {
    return {
      name: "AX Engine local provider",
      status: "ok",
      detail: "not enabled on this host",
    }
  }

  // Prefer shared lifecycle phase when present (LOCAL-ENGINE-CLIENTS contract).
  const phase = status.lifecycle?.phase
  const phasePrefix = phase ? `phase=${phase} backend=${status.lifecycle?.backend ?? "sidecar_http"}; ` : ""

  if (!status.eligibility.supported) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: `${phasePrefix}${status.eligibility.blockers.join("; ")}`,
    }
  }
  if (!status.dependency.available) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: `${phasePrefix}${status.dependency.blockers.join("; ")}`,
    }
  }
  if (!status.model.present && status.disk && !status.disk.ok) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: `${phasePrefix}${status.disk.blockers.join("; ")}`,
    }
  }
  if (!status.model.present) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: `${phasePrefix}eligible; ax-engine available; AX Engine MLX model not prepared`,
    }
  }
  if (phase === "error") {
    return {
      name: "AX Engine local provider",
      status: "fail",
      detail: `${phasePrefix}${(status.lifecycle?.blockers ?? status.server.blockers).join("; ") || "engine error"}`,
    }
  }
  if (phase === "degraded") {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: `${phasePrefix}${status.capability.reason ?? "running with limited capability"}`,
    }
  }
  return {
    name: "AX Engine local provider",
    status: status.server.ready || phase === "ready" ? "ok" : "warn",
    detail: status.server.ready
      ? `${phasePrefix}ready at ${status.server.state?.baseURL}`
      : `${phasePrefix}model prepared at ${status.model.path}; server not running`,
  }
}

async function exists(file: string) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function findAncestor(start: string, predicate: (dir: string) => Promise<boolean>) {
  let current = path.resolve(start)
  while (true) {
    if (await predicate(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function getConfiguredTuiPort(): Promise<number> {
  try {
    const config = await Config.global()
    const configured = config?.server?.port
    if (typeof configured === "number" && configured > 0) return configured
  } catch (error) {
    Log.Default.warn("failed to read configured TUI port; falling back to default", { error })
  }
  return DEFAULT_SERVER_PORT
}

export async function getDuplicateProjectIdentityCheck(input: {
  worktree: string
  useDatabase?: typeof Database.use
}): Promise<{ name: string; status: "ok" | "warn" | "fail"; detail: string } | undefined> {
  const useDatabase = input.useDatabase ?? Database.use
  try {
    const rows = await ProjectIdentity.listWorktreeIdentities({ worktree: input.worktree, useDatabase })
    if (rows.length <= 1) return
    const detail = rows
      .map((row) => `${row.id} (${Locale.pluralize(row.sessionCount, "{} session", "{} sessions")})`)
      .join(", ")
    return {
      name: "Project identity",
      status: "warn",
      detail: `Duplicate project ids for ${input.worktree}: ${detail}. Run project-scoped storage cleanup before continuing old sessions.`,
    }
  } catch (error) {
    return {
      name: "Project identity",
      status: "warn",
      detail: `Could not inspect project identity for ${input.worktree}: ${toErrorMessage(error)}`,
    }
  }
}

export async function doctorProjectContext(callerCwd = Filesystem.callerCwd()) {
  const projectRoot =
    (await findAncestor(
      callerCwd,
      async (dir) => (await exists(path.join(dir, ".git", "HEAD"))) || (await exists(path.join(dir, ".git"))),
    )) ?? callerCwd
  const agentsPath = await findAncestor(callerCwd, (dir) => exists(path.join(dir, "AGENTS.md")))
  const configPath = await findAncestor(
    callerCwd,
    async (dir) =>
      (await exists(path.join(dir, ".ax-code", "ax-code.json"))) || (await exists(path.join(dir, "ax-code.json"))),
  )

  return {
    callerCwd,
    projectRoot,
    agentsPath,
    configPath,
  }
}

export type DoctorCheckEntry = DoctorCheck & { id: string }

export type DoctorReportCheck = {
  id: string
  status: "pass" | "warn" | "fail"
  summary: string
  detail?: string
}

export type DoctorReport = {
  version: string
  ok: boolean
  checks: DoctorReportCheck[]
}

/** Stable machine ids for every doctor check, in run order. `--skip`
 * validates against this list and `--json` emits it, so ids must stay
 * kebab-case and never be renamed; new checks are appended here. */
export const DOCTOR_CHECK_IDS = [
  "version",
  "path-launchers",
  "runtime",
  "platform",
  "data-dir",
  "config",
  "credentials",
  "agents-md",
  "git",
  "project-identity",
  "server-exposure",
  "isolation-policy",
  "evidence-cache",
  "native-addons",
  "stale-instances",
  "ax-engine",
  "computer-use",
  "tui-server",
  "tui-preload",
  "recent-logs",
  "log-access",
  "tui-log-errors",
  "recent-errors",
  "code-index",
  "tui-engine",
  "legacy-render-flags",
  "feature-flags",
] as const

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number]

// getRecentLogsChecks emits several named checks from one scan; map each name
// onto its stable id so every emitted line can be skipped individually.
const RECENT_LOG_CHECK_IDS: Record<string, DoctorCheckId> = {
  "Recent logs": "recent-logs",
  "Log access": "log-access",
  "TUI errors in logs": "tui-log-errors",
  "Recent errors": "recent-errors",
}

function fallbackCheckId(name: string): DoctorCheckId {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") as DoctorCheckId
}

export async function runDoctorChecks(input: { skip?: ReadonlySet<string> } = {}): Promise<DoctorCheckEntry[]> {
  const skip = input.skip ?? new Set<string>()
  const checks: DoctorCheckEntry[] = []
  const push = (id: DoctorCheckId, check: DoctorCheck) => {
    if (!skip.has(id)) checks.push({ id, ...check })
  }
  const project = await doctorProjectContext()
  const tuiPort = await getConfiguredTuiPort()

  // 1. Version
  push("version", {
    name: "Version",
    status: "ok",
    detail: `ax-code ${Installation.VERSION} (${Installation.CHANNEL})`,
  })

  if (!skip.has("path-launchers")) {
    const pathLaunchers = await getPathLauncherCheck()
    if (pathLaunchers) push("path-launchers", pathLaunchers)
  }

  // 2. Runtime
  push("runtime", getRuntimeCheck())

  // 3. Platform
  push("platform", {
    name: "Platform",
    status: "ok",
    detail: `${process.platform} ${process.arch}`,
  })

  // 4. Data directory
  push("data-dir", await getDoctorDatabaseCheck({ databasePath: Database.Path }))

  // 5. Load exactly the configuration that this project uses at runtime. The
  // parsed config also feeds the credentials, isolation, AX Engine, and
  // computer-use checks, so it is loaded even when the config check itself is
  // skipped.
  const configuration = await getDoctorConfiguration(project.callerCwd)
  push("config", configuration.check)

  // 6. Credentials — combine `ax-code providers login` entries (auth.json)
  // with environment variable fallbacks. Previously we only checked
  // a few hardcoded env vars (GOOGLE_GENERATIVE_AI_API_KEY, GROQ_API_KEY,
  // OPENAI_API_KEY) and ignored auth.json entirely, so users who set up
  // credentials via `ax-code providers login` saw a spurious
  // "No credentials found" warning on every doctor run.
  // The env list is now derived from models.dev (one line per provider
  // in the bundled snapshot) so new providers are picked up
  // automatically and doctor stays in sync with the rest of the app.
  // See issue #18.
  if (!skip.has("credentials")) {
    const configuredCredentials = getConfiguredCredentialProviders(configuration.config)
    let credentialSourcesIncomplete = !configuration.config
    const stored: string[] = []
    try {
      const auth = await Auth.all()
      for (const [providerID, info] of Object.entries(auth)) {
        // Every stored credential counts — api keys, oauth refresh
        // tokens, and wellknown configs all unlock a provider.
        if (info.type === "api" || info.type === "oauth" || info.type === "wellknown") {
          stored.push(providerID)
        }
      }
    } catch {
      credentialSourcesIncomplete = true
      // auth.json might not exist on a fresh install — that's fine,
      // we just proceed with the env var check.
    }

    const envKeys: { env: string; provider: string }[] = []
    try {
      const modelsDev = await ModelsDev.get()
      const seenEnv = new Set<string>()
      for (const provider of Object.values(modelsDev)) {
        for (const env of provider.env ?? []) {
          if (seenEnv.has(env)) continue
          seenEnv.add(env)
          if (process.env[env]) envKeys.push({ env, provider: provider.name })
        }
      }
    } catch {
      credentialSourcesIncomplete = true
      // models.dev snapshot failed to load — degrade to no env check
      // rather than crashing the whole doctor report.
    }

    if (stored.length > 0 || envKeys.length > 0 || configuredCredentials.length > 0) {
      const parts: string[] = []
      if (configuredCredentials.length)
        parts.push(`${configuredCredentials.length} in configuration (${configuredCredentials.join(", ")})`)
      if (stored.length > 0) {
        parts.push(`${stored.length} stored (${stored.sort().join(", ")})`)
      }
      if (envKeys.length > 0) {
        parts.push(`${envKeys.length} in environment (${envKeys.map((k) => k.env).join(", ")})`)
      }
      push("credentials", {
        name: "Credentials",
        status: "ok",
        detail: `${parts.join(" + ")}; presence only, authentication not tested${credentialSourcesIncomplete ? "; some sources unavailable" : ""}`,
      })
    } else {
      push("credentials", {
        name: "Credentials",
        status: "warn",
        detail: credentialSourcesIncomplete
          ? "Credential check incomplete: one or more sources could not be loaded; authentication not tested"
          : "No credentials found. Run `ax-code providers login` or set a provider env var (e.g. ANTHROPIC_API_KEY); presence only, authentication not tested",
      })
    }
  }

  // 7. AGENTS.md (checked in the caller's cwd, not the bin shim's --cwd)
  push("agents-md", {
    name: "AGENTS.md context",
    status: project.agentsPath ? "ok" : "warn",
    detail: project.agentsPath
      ? "Found — project context will be injected"
      : 'Not found — run "ax-code init" to generate',
  })

  // 8. Git
  const gitExists =
    project.projectRoot !== project.callerCwd || (await exists(path.join(project.callerCwd, ".git", "HEAD")))
  push("git", {
    name: "Git repository",
    status: gitExists ? "ok" : "warn",
    detail: gitExists ? "Found" : "Not a git repository",
  })

  if (!skip.has("project-identity")) {
    const duplicateProjectIdentity = await getDuplicateProjectIdentityCheck({ worktree: project.projectRoot })
    if (duplicateProjectIdentity) push("project-identity", duplicateProjectIdentity)
  }

  try {
    const globalConfig = await Config.global()
    push(
      "server-exposure",
      getServerExposureCheck({
        hostname: globalConfig?.server?.hostname,
        mdns: globalConfig?.server?.mdns,
        password: Flag.AX_CODE_SERVER_PASSWORD,
      }),
    )
  } catch {
    push(
      "server-exposure",
      getServerExposureCheck({
        password: Flag.AX_CODE_SERVER_PASSWORD,
      }),
    )
  }

  try {
    const config = configuration.config ?? (await Config.global())
    push(
      "isolation-policy",
      getIsolationPolicyCheck({
        config: config?.isolation,
        envMode: Flag.AX_CODE_ISOLATION_MODE,
        envNetwork: Flag.AX_CODE_ISOLATION_NETWORK,
      }),
    )
  } catch {
    push(
      "isolation-policy",
      getIsolationPolicyCheck({
        envMode: Flag.AX_CODE_ISOLATION_MODE,
        envNetwork: Flag.AX_CODE_ISOLATION_NETWORK,
      }),
    )
  }

  // 9. Native Rust addons — routed through the central NativeAddon registry
  // so the doctor reflects the exact same load semantics (flag gating +
  // MODULE_NOT_FOUND filtering) as every runtime call site.
  const addons = [
    { name: "index-core", load: () => NativeAddon.index() },
    { name: "fs", load: () => NativeAddon.fs() },
    { name: "diff", load: () => NativeAddon.diff() },
    { name: "parser", load: () => NativeAddon.parser() },
  ]
  const addonLoaded = new Map(addons.map((a) => [a.name, !!a.load()]))
  push("evidence-cache", getEvidenceCacheCheck())
  push("native-addons", getNativeAddonsCheck(addonLoaded))

  // 10. Stale ax-code processes — multiple instances can block startup,
  // exhaust the port, or corrupt the shared SQLite database.
  if (!skip.has("stale-instances")) {
    const runningInstances = await getRunningInstancesCheck()
    if (runningInstances) push("stale-instances", runningInstances)
  }

  try {
    const config = configuration.config ?? (await Config.global())
    push("ax-engine", getAxEngineDoctorCheck(await getAxEngineStatus(config?.provider?.["ax-engine"]?.options ?? {})))
  } catch (error) {
    push("ax-engine", {
      name: "AX Engine local provider",
      status: "warn",
      detail: `Could not inspect ax-engine status: ${toErrorMessage(error)}`,
    })
  }

  // 11a. Computer use — preflight the configured desktop-control backend
  // (spawn + MCP handshake + list_apps, capped by the probe timeout).
  try {
    const config = configuration.config ?? (await Config.global())
    push("computer-use", await getComputerUseCheck({ config: config?.computer }))
  } catch (error) {
    push("computer-use", {
      name: "Computer use",
      status: "warn",
      detail: `Could not run computer-use preflight: ${toErrorMessage(error)}`,
    })
  }

  // 11b. TUI startup — port conflict and server liveness
  try {
    const serverRunning = await fetch(`http://127.0.0.1:${tuiPort}/`, {
      signal: AbortSignal.timeout(1500),
    })
      .then(() => true)
      .catch(() => false)

    if (serverRunning) {
      push("tui-server", {
        name: "TUI server",
        status: "ok",
        detail: `ax-code server responding on port ${tuiPort} (existing session active)`,
      })
    } else {
      // Check if something else owns the port
      const portBlocked = await new Promise<boolean>((resolve) => {
        const net = require("net")
        const socket = new net.Socket()
        socket.setTimeout(1000)
        socket.on("connect", () => {
          socket.end()
          resolve(true)
        })
        socket.on("error", () => {
          resolve(false)
        })
        socket.on("timeout", () => {
          socket.destroy()
          resolve(false)
        })
        socket.connect(tuiPort, "127.0.0.1")
      })

      push("tui-server", {
        name: "TUI server",
        status: portBlocked ? "warn" : "ok",
        detail: portBlocked
          ? `Port ${tuiPort} is in use by another process — ax-code may fail to start or bind a random port`
          : `Port ${tuiPort} available`,
      })
    }
  } catch {
    push("tui-server", { name: "TUI server", status: "ok", detail: `Port ${tuiPort} available` })
  }

  // 11b. Bun preload — required for source/dev TUI runs. Bundled runtimes
  // transform TUI JSX during build and do not resolve the preload from disk.
  push("tui-preload", getTuiPreloadCheck())

  // 12. Recent logs analysis — scan all log files modified within 24 hours for TUI crashes / errors
  if (Object.values(RECENT_LOG_CHECK_IDS).some((id) => !skip.has(id))) {
    for (const check of await getRecentLogsChecks({ logDir: Global.Path.log })) {
      push(RECENT_LOG_CHECK_IDS[check.name] ?? fallbackCheckId(check.name), check)
    }
  }

  // 12. Code intelligence index status
  try {
    const indexDb = path.join(Global.Path.data, "ax-code-index.db")
    const indexExists = await exists(indexDb)
    if (indexExists) {
      push("code-index", {
        name: "Code index",
        status: "ok",
        detail: `Native index database exists at ${indexDb}`,
      })
    }
  } catch {
    // Best-effort
  }

  // 13. TUI engine
  push("tui-engine", {
    name: "TUI engine",
    status: "ok",
    detail: "AX Code TUI (native Zig renderer)",
  })
  if (process.env.AX_CODE_NATIVE_RENDER === "1" || process.env.AX_CODE_NATIVE_RENDER_SCOPE) {
    push("legacy-render-flags", {
      name: "Legacy native renderer flags",
      status: "warn",
      detail: "AX_CODE_NATIVE_RENDER* is retired and ignored; AX Code TUI always uses its bundled native library.",
    })
  }

  // 14. Feature flags
  const flags: string[] = []
  if (Flag.AX_CODE_DISABLE_MODELS_FETCH) flags.push("DISABLE_MODELS_FETCH")
  if (Flag.AX_CODE_NATIVE_INDEX) flags.push(formatNativeFlag("NATIVE_INDEX", addonLoaded.get("index-core") ?? false))
  if (Flag.AX_CODE_NATIVE_FS) flags.push(formatNativeFlag("NATIVE_FS", addonLoaded.get("fs") ?? false))
  if (Flag.AX_CODE_NATIVE_DIFF) flags.push(formatNativeFlag("NATIVE_DIFF", addonLoaded.get("diff") ?? false))
  if (Flag.AX_CODE_NATIVE_PARSER) flags.push(formatNativeFlag("NATIVE_PARSER", addonLoaded.get("parser") ?? false))
  if (Flag.AX_CODE_DEBUG_ENGINE_NATIVE_SCAN) flags.push("DEBUG_ENGINE_NATIVE_SCAN=on")
  const featureFlags = getFeatureFlagsCheck(flags)
  if (featureFlags) push("feature-flags", featureFlags)

  return checks
}

export function toDoctorReport(checks: DoctorCheckEntry[]): DoctorReport {
  const reportChecks = checks.map((check) => ({
    id: check.id,
    status: check.status === "ok" ? ("pass" as const) : check.status,
    summary: check.name,
    ...(check.detail ? { detail: check.detail } : {}),
  }))
  return {
    version: Installation.VERSION,
    ok: reportChecks.every((check) => check.status !== "fail"),
    checks: reportChecks,
  }
}

export function renderDoctorHuman(checks: DoctorCheckEntry[]): string {
  const lines: string[] = ["", "  ax-code doctor", ""]
  for (const check of checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "△" : "✗"
    const color = check.status === "ok" ? "\x1b[32m" : check.status === "warn" ? "\x1b[33m" : "\x1b[31m"
    lines.push(`  ${color}${icon}\x1b[0m  ${check.name}: ${check.detail}`)
  }

  const fails = checks.filter((c) => c.status === "fail").length
  const warns = checks.filter((c) => c.status === "warn").length

  lines.push("")
  if (fails > 0) {
    lines.push(`  \x1b[31m${Locale.pluralize(fails, "{} issue", "{} issues")} found\x1b[0m`)
  } else if (warns > 0) {
    lines.push(`  \x1b[33m${Locale.pluralize(warns, "{} warning", "{} warnings")}\x1b[0m — system is functional`)
  } else {
    lines.push("  \x1b[32mAll checks passed\x1b[0m")
  }
  lines.push("")
  return lines.join("\n")
}

export async function executeDoctor(
  args: { json?: boolean; skip?: string },
  deps: {
    runChecks?: (input: { skip: ReadonlySet<string> }) => Promise<DoctorCheckEntry[]>
    stdout?: (text: string) => void
    stderr?: (text: string) => void
    exit?: (code: number) => void
  } = {},
): Promise<number> {
  const writeOut = deps.stdout ?? ((text: string) => process.stdout.write(text))
  const writeErr = deps.stderr ?? ((text: string) => process.stderr.write(text))
  const setExit =
    deps.exit ??
    ((code: number) => {
      process.exitCode = code
    })

  const skipList = (args.skip ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  const unknown = skipList.filter((id) => !DOCTOR_CHECK_IDS.includes(id as DoctorCheckId))
  if (unknown.length > 0) {
    writeErr(`ax-code doctor: unknown --skip id(s): ${unknown.join(", ")}. Valid ids: ${DOCTOR_CHECK_IDS.join(", ")}\n`)
    setExit(2)
    return 2
  }

  const checks = await (deps.runChecks ?? runDoctorChecks)({ skip: new Set(skipList) })
  if (args.json) {
    writeOut(JSON.stringify(toDoctorReport(checks), null, 2) + "\n")
  } else {
    writeOut(renderDoctorHuman(checks) + "\n")
  }

  if (checks.some((check) => check.status === "fail")) {
    setExit(1)
    return 1
  }
  return 0
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check system health and diagnose issues",
  builder: (yargs) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit a single machine-readable JSON report and suppress human output",
      })
      .option("skip", {
        type: "string",
        describe: "Comma-separated check ids to skip; unknown ids are an error",
      })
      .epilog(
        `Exit code is 1 when any check fails; warnings never fail.\nCheck ids:\n  ${DOCTOR_CHECK_IDS.join("\n  ")}`,
      ),
  handler: async (args) => {
    await executeDoctor({ json: args.json, skip: args.skip })
  },
})
