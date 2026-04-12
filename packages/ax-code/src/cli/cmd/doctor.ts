/**
 * Doctor command — system health check
 * Ported from ax-cli's doctor command
 *
 * Validates configuration, providers, tools, and environment
 */

import type { CommandModule } from "yargs"
import { Config } from "../../config/config"
import { Installation } from "../../installation"
import { Global } from "../../global"
import { Flag } from "../../flag/flag"
import { Auth } from "../../auth"
import { ModelsDev } from "../../provider/models"
import { NativeStore } from "../../code-intelligence/native-store"
import { Log } from "../../util/log"
import { Filesystem } from "../../util/filesystem"
import { NativeAddon } from "../../native/addon"
import path from "path"
import fs from "fs/promises"

export const DoctorCommand: CommandModule = {
  command: "doctor",
  describe: "check system health and diagnose issues",
  handler: async () => {
    const checks: { name: string; status: "ok" | "warn" | "fail"; detail: string }[] = []

    // 1. Version
    checks.push({
      name: "Version",
      status: "ok",
      detail: `ax-code ${Installation.VERSION} (${Installation.CHANNEL})`,
    })

    // 2. Runtime
    checks.push({
      name: "Runtime",
      status: "ok",
      detail: `Bun ${Bun.version}`,
    })

    // 3. Platform
    checks.push({
      name: "Platform",
      status: "ok",
      detail: `${process.platform} ${process.arch}`,
    })

    // 4. Data directory
    const dataExists = await Bun.file(path.join(Global.Path.data, "ax-code.db")).exists()
    checks.push({
      name: "Data directory",
      status: "ok",
      detail: `${Global.Path.data} ${dataExists ? "(database exists)" : "(no database yet)"}`,
    })

    // 5. Config
    try {
      const config = await Config.get()
      const providerCount = Object.keys(config.provider ?? {}).length
      checks.push({
        name: "Configuration",
        status: "ok",
        detail: `Loaded (${providerCount} provider${providerCount !== 1 ? "s" : ""} configured)`,
      })
    } catch {
      // Config.get() requires project instance which isn't available in standalone CLI mode
      // Check if config file exists instead
      const configExists = await Bun.file(path.join(process.cwd(), ".ax-code", "ax-code.json")).exists()
        || await Bun.file(path.join(process.cwd(), "ax-code.json")).exists()
      checks.push({
        name: "Configuration",
        status: configExists ? "ok" : "warn",
        detail: configExists ? "Config file found" : "No config file — using defaults (this is fine)",
      })
    }

    // 6. API keys — combine `ax-code providers login` entries (auth.json)
    // with environment variable fallbacks. Previously we only checked
    // three hardcoded env vars (GOOGLE_GENERATIVE_AI_API_KEY, XAI_API_KEY,
    // GROQ_API_KEY) and ignored auth.json entirely, so users who set up
    // credentials via `ax-code providers login` saw a spurious
    // "No API keys found in environment" warning on every doctor run.
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
        name: "API keys",
        status: "ok",
        detail: parts.join(" + "),
      })
    } else {
      checks.push({
        name: "API keys",
        status: "warn",
        detail: "No API keys found. Run `ax-code providers login` or set a provider env var (e.g. ANTHROPIC_API_KEY)",
      })
    }

    // 7. AGENTS.md (checked in the caller's cwd, not the bin shim's --cwd)
    const callerCwd = Filesystem.callerCwd()
    const agentsMdExists = await Bun.file(path.join(callerCwd, "AGENTS.md")).exists()
    const legacyAxMdExists = await Bun.file(path.join(callerCwd, "AX.md")).exists()
    checks.push({
      name: "AGENTS.md context",
      status: agentsMdExists ? "ok" : "warn",
      detail: agentsMdExists
        ? legacyAxMdExists
          ? "Found — project context will be injected (legacy AX.md also present; safe to delete)"
          : "Found — project context will be injected"
        : legacyAxMdExists
          ? 'Legacy AX.md found — run "ax-code init --force" to migrate to AGENTS.md'
          : 'Not found — run "ax-code init" to generate',
    })

    // 8. Git
    const gitExists = await Bun.file(".git/HEAD").exists()
    checks.push({
      name: "Git repository",
      status: gitExists ? "ok" : "warn",
      detail: gitExists ? "Found" : "Not a git repository",
    })

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

    // 10. Recent logs analysis
    try {
      const logDir = Global.Path.log
      const logFiles = await fs.readdir(logDir).catch(() => [] as string[])
      const recentLog = logFiles.filter(f => f.endsWith(".log") && !f.endsWith(".json.log")).sort().pop()
      if (recentLog) {
        const content = await fs.readFile(path.join(logDir, recentLog), "utf8").catch(() => "")
        const lines = content.split("\n").filter(Boolean)
        const errors = lines.filter(l => l.startsWith("ERROR"))
        const warns = lines.filter(l => l.startsWith("WARN"))
        checks.push({
          name: "Recent logs",
          status: errors.length > 10 ? "warn" : "ok",
          detail: `${recentLog}: ${lines.length} lines, ${errors.length} errors, ${warns.length} warnings`,
        })

        // Show last 3 errors if any
        if (errors.length > 0) {
          const recent = errors.slice(-3)
          checks.push({
            name: "Recent errors",
            status: "warn",
            detail: recent.map(e => e.slice(0, 120)).join(" | "),
          })
        }
      }
    } catch {
      // Log analysis is best-effort
    }

    // 11. Code intelligence index status
    try {
      const indexDb = path.join(Global.Path.data, "ax-code-index.db")
      const indexExists = await Bun.file(indexDb).exists()
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

    // 12. Feature flags
    const flags: string[] = []
    if (Flag.AX_CODE_DISABLE_MODELS_FETCH) flags.push("DISABLE_MODELS_FETCH")
    if (Flag.AX_CODE_NATIVE_INDEX) flags.push("NATIVE_INDEX=on")
    if (Flag.AX_CODE_NATIVE_FS) flags.push("NATIVE_FS=on")
    if (Flag.AX_CODE_NATIVE_DIFF) flags.push("NATIVE_DIFF=on")
    if (Flag.AX_CODE_NATIVE_PARSER) flags.push("NATIVE_PARSER=on")
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
      console.log(`  \x1b[31m${fails} issue${fails > 1 ? "s" : ""} found\x1b[0m`)
    } else if (warns > 0) {
      console.log(`  \x1b[33m${warns} warning${warns > 1 ? "s" : ""}\x1b[0m — system is functional`)
    } else {
      console.log("  \x1b[32mAll checks passed\x1b[0m")
    }
    console.log("")
  },
}
