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
import path from "path"

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

    // 6. API keys
    const keyChecks: [string, string][] = [
      ["GOOGLE_GENERATIVE_AI_API_KEY", "Google"],
      ["OPENAI_API_KEY", "OpenAI"],
      ["XAI_API_KEY", "XAI/Grok"],
      ["OPENROUTER_API_KEY", "OpenRouter"],
      ["MISTRAL_API_KEY", "Mistral"],
      ["GROQ_API_KEY", "Groq"],
    ]

    let hasKey = false
    for (const [env, name] of keyChecks) {
      if (process.env[env]) {
        checks.push({ name: `${name} API key`, status: "ok", detail: `${env} is set` })
        hasKey = true
      }
    }

    if (!hasKey) {
      checks.push({
        name: "API keys",
        status: "warn",
        detail: "No API keys found in environment. Set at least one (e.g., GOOGLE_GENERATIVE_AI_API_KEY)",
      })
    }

    // 7. AX.md
    const axMdExists = await Bun.file("AX.md").exists()
    checks.push({
      name: "AX.md context",
      status: axMdExists ? "ok" : "warn",
      detail: axMdExists ? "Found — project context will be injected" : 'Not found — run "ax-code init" to generate',
    })

    // 8. Git
    const gitExists = await Bun.file(".git/HEAD").exists()
    checks.push({
      name: "Git repository",
      status: gitExists ? "ok" : "warn",
      detail: gitExists ? "Found" : "Not a git repository",
    })

    // 9. Feature flags
    const flags: string[] = []
    if (Flag.AX_CODE_DISABLE_MODELS_FETCH) flags.push("DISABLE_MODELS_FETCH")
    if (Flag.AX_CODE_DISABLE_SHARE) flags.push("DISABLE_SHARE")
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
