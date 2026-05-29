import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { resolveMacEntitlementsPath } from "./entitlements"

export type MacReleasePreflightCheck = {
  status: "passed" | "failed"
  reason?: string
}

export type MacReleasePreflightCommand = {
  command: string
  args: string[]
}

export type MacReleasePreflightCommandResult = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export type MacReleasePreflightOptions = {
  signingIdentity?: string
  notarization:
    | { profile?: string }
    | {
        appleId?: string
        password?: string
        teamId?: string
      }
  updateFeedUrl?: string
  entitlementsPath?: string
  platform?: NodeJS.Platform
  exists?: (file: string) => boolean
  commandRunner?: (command: MacReleasePreflightCommand) => Promise<MacReleasePreflightCommandResult>
}

export type MacReleasePreflightReport = {
  ready: boolean
  checks: {
    platform: MacReleasePreflightCheck
    tools: MacReleasePreflightCheck
    signingIdentity: MacReleasePreflightCheck
    entitlements: MacReleasePreflightCheck
    notarization: MacReleasePreflightCheck
    updateFeedUrl: MacReleasePreflightCheck
  }
}

export async function createMacReleasePreflightReport(
  options: MacReleasePreflightOptions,
): Promise<MacReleasePreflightReport> {
  const platform = options.platform ?? process.platform
  const commandRunner = options.commandRunner ?? runPreflightCommand
  const exists = options.exists ?? existsSync
  const entitlementsPath = resolveMacEntitlementsPath(options.entitlementsPath)
  const tools = await checkTools({ exists, commandRunner, signingIdentity: options.signingIdentity })
  const checks = {
    platform: checkPlatform(platform),
    tools,
    signingIdentity: checkSigningIdentity(options.signingIdentity),
    entitlements: checkEntitlements(entitlementsPath, exists),
    notarization: await checkNotarization(options.notarization, commandRunner),
    updateFeedUrl: checkUpdateFeedUrl(options.updateFeedUrl),
  }
  return {
    ready: Object.values(checks).every((check) => check.status === "passed"),
    checks,
  }
}

export function writeMacReleasePreflightReport(report: MacReleasePreflightReport, outputPath: string) {
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}

function checkPlatform(platform: NodeJS.Platform): MacReleasePreflightCheck {
  return platform === "darwin"
    ? { status: "passed" }
    : { status: "failed", reason: `macOS release requires darwin runner; got ${platform}.` }
}

async function checkTools(input: {
  exists: (file: string) => boolean
  commandRunner: (command: MacReleasePreflightCommand) => Promise<MacReleasePreflightCommandResult>
  signingIdentity?: string
}): Promise<MacReleasePreflightCheck> {
  const missing = ["/usr/bin/codesign", "/usr/bin/ditto", "/usr/bin/xcrun", "/usr/bin/security"].filter(
    (file) => !input.exists(file),
  )
  if (missing.length > 0) return { status: "failed", reason: `Missing macOS release tools: ${missing.join(", ")}` }

  const notarytool = await input.commandRunner({ command: "/usr/bin/xcrun", args: ["--find", "notarytool"] })
  if (notarytool.exitCode !== 0) {
    return { status: "failed", reason: `notarytool is unavailable: ${commandFailure(notarytool)}` }
  }
  const stapler = await input.commandRunner({ command: "/usr/bin/xcrun", args: ["--find", "stapler"] })
  if (stapler.exitCode !== 0) {
    return { status: "failed", reason: `stapler is unavailable: ${commandFailure(stapler)}` }
  }
  if (input.signingIdentity) {
    const identities = await input.commandRunner({
      command: "/usr/bin/security",
      args: ["find-identity", "-v", "-p", "codesigning"],
    })
    if (identities.exitCode !== 0) {
      return { status: "failed", reason: `Code signing identities are unavailable: ${commandFailure(identities)}` }
    }
    if (!identities.stdout?.includes(input.signingIdentity)) {
      return { status: "failed", reason: "Configured code signing identity was not found in the keychain." }
    }
  }
  return { status: "passed" }
}

function checkSigningIdentity(signingIdentity: string | undefined): MacReleasePreflightCheck {
  return signingIdentity
    ? { status: "passed" }
    : { status: "failed", reason: "Missing --signing-identity or APPLE_SIGNING_IDENTITY." }
}

function checkEntitlements(entitlementsPath: string, exists: (file: string) => boolean): MacReleasePreflightCheck {
  return exists(entitlementsPath)
    ? { status: "passed" }
    : { status: "failed", reason: `Mac release entitlements file is missing: ${entitlementsPath}` }
}

async function checkNotarization(
  notarization: MacReleasePreflightOptions["notarization"],
  commandRunner: (command: MacReleasePreflightCommand) => Promise<MacReleasePreflightCommandResult>,
): Promise<MacReleasePreflightCheck> {
  if (isProfileNotarization(notarization)) {
    if (!notarization.profile) {
      return { status: "failed", reason: "Missing --notary-profile or APPLE_NOTARY_PROFILE." }
    }
    const profile = await commandRunner({
      command: "/usr/bin/xcrun",
      args: ["notarytool", "history", "--keychain-profile", notarization.profile],
    })
    if (profile.exitCode !== 0) {
      return { status: "failed", reason: `Notary keychain profile is unavailable: ${commandFailure(profile)}` }
    }
    return { status: "passed" }
  }
  if (notarization.appleId && notarization.password && notarization.teamId) return { status: "passed" }
  return {
    status: "failed",
    reason: "Missing Apple ID notarization credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.",
  }
}

function isProfileNotarization(
  notarization: MacReleasePreflightOptions["notarization"],
): notarization is { profile?: string } {
  return Object.prototype.hasOwnProperty.call(notarization, "profile")
}

function checkUpdateFeedUrl(updateFeedUrl: string | undefined): MacReleasePreflightCheck {
  if (!updateFeedUrl) return { status: "failed", reason: "Missing --update-feed-url." }
  let url: URL
  try {
    url = new URL(updateFeedUrl)
  } catch {
    return { status: "failed", reason: "Update feed URL must be a valid HTTPS URL." }
  }
  if (url.protocol !== "https:") return { status: "failed", reason: "Update feed URL must use HTTPS." }
  return { status: "passed" }
}

function commandFailure(result: MacReleasePreflightCommandResult) {
  return (result.stderr || result.stdout || `exit code ${result.exitCode}`).trim()
}

async function runPreflightCommand(command: MacReleasePreflightCommand): Promise<MacReleasePreflightCommandResult> {
  const proc = Bun.spawn([command.command, ...command.args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "signing-identity": { type: "string" },
      "notary-profile": { type: "string" },
      "apple-id": { type: "string" },
      "apple-password": { type: "string" },
      "apple-team-id": { type: "string" },
      "update-feed-url": { type: "string" },
      entitlements: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  })
  const signingIdentity = values["signing-identity"] ?? process.env.APPLE_SIGNING_IDENTITY
  const updateFeedUrl = values["update-feed-url"] ?? process.env.AX_CODE_DESKTOP_UPDATE_FEED_URL
  const notaryProfile = values["notary-profile"] ?? process.env.APPLE_NOTARY_PROFILE
  const appleId = values["apple-id"] ?? process.env.APPLE_ID
  const applePassword = values["apple-password"] ?? process.env.APPLE_APP_SPECIFIC_PASSWORD
  const appleTeamId = values["apple-team-id"] ?? process.env.APPLE_TEAM_ID
  const notarization = notaryProfile
    ? { profile: notaryProfile }
    : { appleId, password: applePassword, teamId: appleTeamId }
  const report = await createMacReleasePreflightReport({
    signingIdentity,
    notarization,
    updateFeedUrl,
    entitlementsPath: values.entitlements,
  })
  const json = JSON.stringify(report, null, 2)
  if (values.output) writeMacReleasePreflightReport(report, values.output)
  console.log(json)
  if (!report.ready) process.exitCode = 1
}
