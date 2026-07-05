/**
 * Doctor command — system health check
 * Ported from ax-cli's doctor command
 *
 * Validates configuration, providers, tools, and environment
 */

import type { CommandModule } from "yargs"
import { Config } from "../../config/config"
import { Installation } from "../../installation"
import { runtimeMode } from "../../installation/runtime-mode"
import { Global } from "../../global"
import { Flag } from "../../flag/flag"
import { Auth } from "../../auth"
import { ModelsDev } from "../../provider/models"
import { Log } from "../../util/log"
import { Filesystem } from "../../util/filesystem"
import { NativeAddon } from "../../native/addon"
import { Database } from "../../storage/db"
import { recordCount } from "@/util/record"
import { Locale } from "@/util/locale"
import { getTuiPreloadCheck } from "./doctor-preload"
import { getDoctorDatabaseCheck } from "./doctor-storage"
import { getRecentLogsChecks, getRunningInstancesCheck } from "./doctor-health"
import path from "path"
import { ProjectIdentity } from "../../project/project-identity"
import { isLoopbackHostname } from "../../runtime/listen-security"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import type { Isolation as IsolationConfig } from "../../config/schema"
import { access } from "fs/promises"
import { Isolation } from "../../isolation"
import { toErrorMessage } from "@/util/error-message"
import { isPlausiblySupportedHost } from "@/provider/ax-engine/platform"
import { getAxEngineStatus } from "@/provider/ax-engine/status"

type DoctorCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string }

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

export function getServerExposureCheck(input: { hostname?: string; mdns?: boolean; password?: string }): DoctorCheck {
  const hostname = input.hostname ?? (input.mdns ? "0.0.0.0" : "127.0.0.1")
  const loopbackOnly = isLoopbackHostname(hostname)
  const authConfigured = !!input.password
  if (!loopbackOnly && !authConfigured) {
    return {
      name: "Server exposure",
      status: "fail",
      detail: `hostname ${hostname} is network-accessible and AX_CODE_SERVER_PASSWORD is not set`,
    }
  }
  return {
    name: "Server exposure",
    status: "ok",
    detail: `hostname ${hostname}; ${loopbackOnly ? "loopback-only" : "network-accessible"}; auth ${
      authConfigured ? "configured" : "not configured"
    }`,
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
  if (!status.eligibility.supported) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: status.eligibility.blockers.join("; "),
    }
  }
  if (!status.dependency.available) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: status.dependency.blockers.join("; "),
    }
  }
  if (!status.model.present && status.disk && !status.disk.ok) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: status.disk.blockers.join("; "),
    }
  }
  if (!status.model.present) {
    return {
      name: "AX Engine local provider",
      status: "warn",
      detail: "eligible; ax-engine available; AX Engine MLX model not prepared",
    }
  }
  return {
    name: "AX Engine local provider",
    status: status.server.ready ? "ok" : "warn",
    detail: status.server.ready
      ? `ready at ${status.server.state?.baseURL}`
      : `model prepared at ${status.model.path}; server not running`,
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

export const DoctorCommand: CommandModule = {
  command: "doctor",
  describe: "check system health and diagnose issues",
  handler: async () => {
    const checks: DoctorCheck[] = []
    const project = await doctorProjectContext()
    const tuiPort = await getConfiguredTuiPort()

    // 1. Version
    checks.push({
      name: "Version",
      status: "ok",
      detail: `ax-code ${Installation.VERSION} (${Installation.CHANNEL})`,
    })

    // 2. Runtime
    checks.push(getRuntimeCheck())

    // 3. Platform
    checks.push({
      name: "Platform",
      status: "ok",
      detail: `${process.platform} ${process.arch}`,
    })

    // 4. Data directory
    checks.push(await getDoctorDatabaseCheck({ databasePath: Database.Path }))

    // 5. Config
    try {
      const config = await Config.get()
      const providerCount = recordCount(config.provider)
      checks.push({
        name: "Configuration",
        status: "ok",
        detail: `Loaded (${Locale.pluralize(providerCount, "{} provider", "{} providers")} configured)`,
      })
    } catch {
      // Config.get() requires project instance which isn't available in standalone CLI mode
      // Check if config file exists instead
      checks.push({
        name: "Configuration",
        status: project.configPath ? "ok" : "warn",
        detail: project.configPath ? "Config file found" : "No config file — using defaults (this is fine)",
      })
    }

    // 6. Credentials — combine `ax-code providers login` entries (auth.json)
    // with environment variable fallbacks. Previously we only checked
    // three hardcoded env vars (GOOGLE_GENERATIVE_AI_API_KEY, XAI_API_KEY,
    // GROQ_API_KEY) and ignored auth.json entirely, so users who set up
    // credentials via `ax-code providers login` saw a spurious
    // "No credentials found" warning on every doctor run.
    // The env list is now derived from models.dev (one line per provider
    // in the bundled snapshot) so new providers are picked up
    // automatically and doctor stays in sync with the rest of the app.
    // See issue #18.
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
      // models.dev snapshot failed to load — degrade to no env check
      // rather than crashing the whole doctor report.
    }

    if (stored.length > 0 || envKeys.length > 0) {
      const parts: string[] = []
      if (stored.length > 0) {
        parts.push(`${stored.length} stored (${stored.sort().join(", ")})`)
      }
      if (envKeys.length > 0) {
        parts.push(`${envKeys.length} in environment (${envKeys.map((k) => k.env).join(", ")})`)
      }
      checks.push({
        name: "Credentials",
        status: "ok",
        detail: parts.join(" + "),
      })
    } else {
      checks.push({
        name: "Credentials",
        status: "warn",
        detail:
          "No credentials found. Run `ax-code providers login` or set a provider env var (e.g. ANTHROPIC_API_KEY)",
      })
    }

    // 7. AGENTS.md (checked in the caller's cwd, not the bin shim's --cwd)
    checks.push({
      name: "AGENTS.md context",
      status: project.agentsPath ? "ok" : "warn",
      detail: project.agentsPath
        ? "Found — project context will be injected"
        : 'Not found — run "ax-code init" to generate',
    })

    // 8. Git
    const gitExists =
      project.projectRoot !== project.callerCwd ||
      (await exists(path.join(project.callerCwd, ".git", "HEAD")))
    checks.push({
      name: "Git repository",
      status: gitExists ? "ok" : "warn",
      detail: gitExists ? "Found" : "Not a git repository",
    })

    const duplicateProjectIdentity = await getDuplicateProjectIdentityCheck({ worktree: project.projectRoot })
    if (duplicateProjectIdentity) checks.push(duplicateProjectIdentity)

    try {
      const globalConfig = await Config.global()
      checks.push(
        getServerExposureCheck({
          hostname: globalConfig?.server?.hostname,
          mdns: globalConfig?.server?.mdns,
          password: Flag.AX_CODE_SERVER_PASSWORD,
        }),
      )
    } catch {
      checks.push(
        getServerExposureCheck({
          password: Flag.AX_CODE_SERVER_PASSWORD,
        }),
      )
    }

    try {
      const config = await Config.get().catch(() => Config.global())
      checks.push(
        getIsolationPolicyCheck({
          config: config?.isolation,
          envMode: Flag.AX_CODE_ISOLATION_MODE,
          envNetwork: Flag.AX_CODE_ISOLATION_NETWORK,
        }),
      )
    } catch {
      checks.push(
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
    const installed = addons.filter((a) => !!a.load()).map((a) => a.name)
    checks.push({
      name: "Native addons",
      status: installed.length > 0 ? "ok" : "warn",
      detail:
        installed.length > 0
          ? `${installed.length}/${addons.length} installed (${installed.join(", ")})`
          : 'None installed — using TypeScript fallbacks (run "pnpm build:native" at the repo root for faster indexing/search)',
    })

    // 10. Stale ax-code processes — multiple instances can block startup,
    // exhaust the port, or corrupt the shared SQLite database.
    const runningInstances = await getRunningInstancesCheck()
    if (runningInstances) checks.push(runningInstances)

    try {
      const config = await Config.get().catch(() => Config.global())
      checks.push(getAxEngineDoctorCheck(await getAxEngineStatus(config?.provider?.["ax-engine"]?.options ?? {})))
    } catch (error) {
      checks.push({
        name: "AX Engine local provider",
        status: "warn",
        detail: `Could not inspect ax-engine status: ${toErrorMessage(error)}`,
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
        checks.push({
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

        checks.push({
          name: "TUI server",
          status: portBlocked ? "warn" : "ok",
          detail: portBlocked
            ? `Port ${tuiPort} is in use by another process — ax-code may fail to start or bind a random port`
            : `Port ${tuiPort} available`,
        })
      }
    } catch {
      checks.push({ name: "TUI server", status: "ok", detail: `Port ${tuiPort} available` })
    }

    // 11b. Bun preload — required for source/dev TUI runs. Bundled runtimes
    // transform TUI JSX during build and do not resolve the preload from disk.
    checks.push(getTuiPreloadCheck())

    // 12. Recent logs analysis — scan last 5 log files for TUI crashes / errors
    checks.push(...(await getRecentLogsChecks({ logDir: Global.Path.log })))

    // 12. Code intelligence index status
    try {
      const indexDb = path.join(Global.Path.data, "ax-code-index.db")
      const indexExists = await exists(indexDb)
      if (indexExists) {
        checks.push({
          name: "Code index",
          status: "ok",
          detail: `Native index database exists at ${indexDb}`,
        })
      }
    } catch {
      // Best-effort
    }

    // 13. Feature flags
    const flags: string[] = []
    if (Flag.AX_CODE_DISABLE_MODELS_FETCH) flags.push("DISABLE_MODELS_FETCH")
    if (Flag.AX_CODE_NATIVE_INDEX) flags.push("NATIVE_INDEX=on")
    if (Flag.AX_CODE_NATIVE_FS) flags.push("NATIVE_FS=on")
    if (Flag.AX_CODE_NATIVE_DIFF) flags.push("NATIVE_DIFF=on")
    if (Flag.AX_CODE_NATIVE_PARSER) flags.push("NATIVE_PARSER=on")
    if (Flag.AX_CODE_DEBUG_ENGINE_NATIVE_SCAN) flags.push("DEBUG_ENGINE_NATIVE_SCAN=on")
    if (flags.length > 0) {
      checks.push({ name: "Feature flags", status: "ok", detail: flags.join(", ") })
    }

    // Print results
    console.log("\n  ax-code doctor\n")

    for (const check of checks) {
      const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "△" : "✗"
      const color = check.status === "ok" ? "\x1b[32m" : check.status === "warn" ? "\x1b[33m" : "\x1b[31m"
      console.log(`  ${color}${icon}\x1b[0m  ${check.name}: ${check.detail}`)
    }

    const fails = checks.filter((c) => c.status === "fail").length
    const warns = checks.filter((c) => c.status === "warn").length

    console.log("")
    if (fails > 0) {
      console.log(`  \x1b[31m${Locale.pluralize(fails, "{} issue", "{} issues")} found\x1b[0m`)
    } else if (warns > 0) {
      console.log(`  \x1b[33m${Locale.pluralize(warns, "{} warning", "{} warnings")}\x1b[0m — system is functional`)
    } else {
      console.log("  \x1b[32mAll checks passed\x1b[0m")
    }
    console.log("")
  },
}
