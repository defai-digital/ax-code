import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { cmd } from "./cmd"
import { staleRuntimeNotice } from "../runtime-upgrade-notice"

export type UpgradeCheckReport = {
  current: string
  latest: string | null
  upToDate: boolean | null
  method: Installation.Method
  error?: string
}

export type UpgradeCheckOutcome = {
  report: UpgradeCheckReport
  exitCode: 0 | 1 | 2
}

// Non-interactive version probe behind `ax-code upgrade check`. Shares
// Installation.check with the TUI update dialog and never installs anything.
export async function runUpgradeCheck(input: { method?: "curl" | "brew" } = {}): Promise<UpgradeCheckOutcome> {
  const { releaseType: _releaseType, ...report } = await Installation.check({ method: input.method })
  const exitCode = report.error ? 2 : report.upToDate ? 0 : 1
  return { report, exitCode }
}

export function renderUpgradeCheckHuman(report: UpgradeCheckReport): string {
  if (report.error) return `upgrade check failed: ${report.error}`
  if (report.upToDate) return `ax-code ${report.current} is up to date (method: ${report.method})`
  return `update available: ax-code ${report.current} → ${report.latest} (method: ${report.method}) — run \`ax-code upgrade\` to install`
}

export const UpgradeCheckCommand = cmd({
  command: "check",
  describe:
    "check whether an ax-code update is available without upgrading (exit 0 = up to date, 1 = update available, 2 = check failed)",
  builder: (yargs) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit a single machine-readable JSON document",
      })
      .option("method", {
        describe: "installation method to check against (default: auto-detect)",
        type: "string",
        choices: ["curl", "brew"],
      }),
  handler: async (args) => {
    const outcome = await runUpgradeCheck({ method: args.method as "curl" | "brew" | undefined })
    if (args.json) {
      process.stdout.write(JSON.stringify(outcome.report, null, 2) + "\n")
    } else if (outcome.report.error) {
      process.stderr.write(renderUpgradeCheckHuman(outcome.report) + "\n")
    } else {
      process.stdout.write(renderUpgradeCheckHuman(outcome.report) + "\n")
    }
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode
  },
})

function formatShadowedLauncherWarning(target: string, check: Installation.LauncherCheck): string {
  const lines = [
    `Upgraded to v${target}, but your shell resolves \`ax-code\` to:`,
    `  ${check.activePath}`,
    check.activeVersion
      ? `That launcher reports v${check.activeVersion} — running \`ax-code\` will keep using the older version until this is resolved.`
      : `That launcher's version could not be determined — running \`ax-code\` may not use the version you just installed.`,
  ]
  const otherLaunchers = check.launchers.slice(1)
  if (otherLaunchers.length) {
    lines.push("", "Other ax-code executables found on PATH:", ...otherLaunchers.map((p) => `  ${p}`))
  }
  lines.push(
    "",
    "Try:",
    ...(process.platform === "win32"
      ? [`  where ax-code`, `  Move-Item "${check.activePath}" "${check.activePath}.bak"`]
      : [`  which -a ax-code`, `  hash -r`, `  mv ${check.activePath} ${check.activePath}.bak`]),
  )
  return lines.join("\n")
}

function formatMissingLauncherWarning(target: string, method: Installation.Method): string {
  const lines = [`Upgraded to v${target}, but no \`ax-code\` launcher was found on PATH.`]
  if (method === "brew") {
    lines.push(
      `Homebrew skips linking the ax-code formula while a cask named "ax-code" is installed, and the upgrade removes the previously linked keg — leaving no ax-code command.`,
      "",
      "Restore it with:",
      "  brew link ax-code",
      "  hash -r",
    )
  } else {
    lines.push("", "Restart your shell, or check that the install directory is still on PATH.")
  }
  return lines.join("\n")
}

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade ax-code to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "brew"],
      })
      .command(UpgradeCheckCommand)
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    prompts.log.info(`Current version: ${Installation.VERSION}`)

    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`ax-code is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      // `prompts.select` returns a cancel symbol (truthy) on Ctrl-C/ESC, so a
      // bare `!install` check would fall through and upgrade anyway. Treat a
      // cancel the same as choosing "No".
      if (prompts.isCancel(install) || !install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info(`Install method: ${method}`)

    const checkSpinner = prompts.spinner()
    checkSpinner.start("Checking for updates...")
    let target: string
    try {
      target = args.target ? args.target.replace(/^v/, "") : await Installation.latest(method)
    } catch (err) {
      checkSpinner.stop("Failed to check for updates")
      prompts.log.error(err instanceof Error ? err.message : String(err))
      prompts.outro("Done")
      return
    }
    checkSpinner.stop(`Latest version: ${target}`)

    if (Installation.VERSION === target) {
      prompts.log.success(`Already up to date (v${target})`)
      prompts.outro("Done")
      return
    }

    prompts.log.step(`Upgrading: v${Installation.VERSION} → v${target}`)
    const spinner = prompts.spinner()
    spinner.start("Downloading and installing...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.error("Upgrade failed")
      if (err instanceof Installation.UpgradeFailedError) {
        prompts.log.error(err.stderr)
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop(`Upgraded to v${target}`)
    prompts.log.success(`v${Installation.VERSION} → v${target}`)

    const launcherCheck = await Installation.verifyActiveLauncher(target).catch(() => undefined)
    if (launcherCheck && !launcherCheck.ok) {
      if (launcherCheck.activePath) {
        prompts.log.warn(formatShadowedLauncherWarning(target, launcherCheck))
      } else {
        prompts.log.warn(formatMissingLauncherWarning(target, method))
      }
    }

    // ADR-251: persistent runtime servers keep running the old version until
    // restarted. List them with the exact restart command; never restart one.
    const staleLines = await staleRuntimeNotice(target).catch(() => [] as string[])
    for (const line of staleLines) prompts.log.warn(line)

    prompts.outro("Done")
  },
}
