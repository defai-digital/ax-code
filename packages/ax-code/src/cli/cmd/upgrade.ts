import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { cmd } from "./cmd"
import { staleRuntimeNotice } from "../runtime-upgrade-notice"
import { toErrorMessage } from "../../util/error-message"

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
  // An undetected method can still answer "up to date" from the public
  // release index. Installing that answer stays a separate decision.
  const { releaseType: _releaseType, ...report } = await Installation.check({
    method: input.method,
    unknownMethod: "curl",
  })
  const exitCode = report.error ? 2 : report.upToDate ? 0 : 1
  return { report, exitCode }
}

export type UnknownUpgradeAction =
  | { kind: "up-to-date"; current: string; desktop: boolean; activePath: string }
  | { kind: "desktop"; activePath: string; latest: string | null; error?: string; updateAvailable: boolean }
  | { kind: "noninteractive"; message: string; exitCode: 2 }
  | { kind: "prompt"; activePath: string }

// `ax-code upgrade` with an undetected method must not call prompts.select
// unless stdin is a TTY (#496). A desktop bundle is not a curl install.
export function decideUnknownUpgrade(input: {
  activePath: string
  interactive: boolean
  explicitTarget: boolean
  desktop: boolean
  report?: UpgradeCheckReport
}): UnknownUpgradeAction {
  if (!input.explicitTarget && input.report?.upToDate && input.report.current) {
    return {
      kind: "up-to-date",
      current: input.report.current,
      desktop: input.desktop,
      activePath: input.activePath,
    }
  }
  if (input.desktop) {
    return {
      kind: "desktop",
      activePath: input.activePath,
      latest: input.report?.latest ?? null,
      error: input.report?.error,
      updateAvailable: input.report?.upToDate === false && Boolean(input.report.latest),
    }
  }
  if (!input.interactive) {
    return { kind: "noninteractive", message: noninteractiveUnknownMessage(input.report), exitCode: 2 }
  }
  return { kind: "prompt", activePath: input.activePath }
}

function noninteractiveUnknownMessage(report: UpgradeCheckReport | undefined): string {
  const guidance = "could not determine the install method; re-run with --method curl|brew"
  if (!report) return guidance
  if (report.error) return renderUpgradeCheckHuman(report)
  if (report.upToDate === false && report.latest) return `${renderUpgradeCheckHuman(report)}\n${guidance}`
  return guidance
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
      const activePath = await Installation.activeInstallPath()
      const report = args.target ? undefined : await Installation.check({ method: "unknown", unknownMethod: "curl" })
      const action = decideUnknownUpgrade({
        activePath,
        interactive: process.stdin.isTTY === true,
        explicitTarget: Boolean(args.target),
        desktop: Installation.desktopBundleEntry(activePath),
        report,
      })
      if (action.kind === "up-to-date") {
        prompts.log.success(`Already up to date (v${action.current})`)
        if (action.desktop) {
          prompts.log.info(
            `This copy is the AX Code desktop bundle at ${action.activePath}. The desktop app updates it.`,
          )
        }
        prompts.outro("Done")
        return
      }
      if (action.kind === "desktop") {
        prompts.log.error(
          `ax-code at ${action.activePath} is the desktop app bundle. The desktop app updates this copy; ax-code upgrade does not replace it.`,
        )
        if (action.updateAvailable && action.latest) {
          prompts.log.info(
            `CLI release v${action.latest} is available. Update AX Code from the desktop app, or install the standalone CLI with \`ax-code upgrade --method curl\`.`,
          )
          process.exitCode = 1
        } else if (action.error) {
          prompts.log.error(action.error)
          process.exitCode = 2
        } else {
          process.exitCode = 1
        }
        prompts.outro("Done")
        return
      }
      if (action.kind === "noninteractive") {
        prompts.log.error(action.message)
        prompts.outro("Done")
        process.exitCode = action.exitCode
        return
      }
      prompts.log.error(`ax-code is installed to ${action.activePath} and may be managed by a package manager`)
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
      process.exitCode = 2
      prompts.log.error(toErrorMessage(err) || "Failed to check for updates")
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
    try {
      await Installation.upgrade(method, target)
    } catch (err) {
      process.exitCode = 1
      spinner.error("Upgrade failed")
      if (err instanceof Installation.UpgradeFailedError) {
        prompts.log.error(err.stderr || err.message)
      } else prompts.log.error(toErrorMessage(err) || "Upgrade failed")
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
