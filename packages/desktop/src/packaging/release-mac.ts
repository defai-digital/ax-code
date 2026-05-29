import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { assertMacEntitlementsFile, resolveMacEntitlementsPath } from "./entitlements"
import { packageMacApp, type MacAppBundle, type MacPackagingResult } from "./mac"
import { type MacReleaseManifest, type MacReleaseUpdateFeed } from "./release-diagnostics"

export type MacReleaseCommand = {
  command: string
  args: string[]
  cwd?: string
}

export type MacReleaseCommandRunner = (command: MacReleaseCommand) => Promise<void>

export type MacReleasePipelineOptions = {
  version?: string
  outDir?: string
  appDist?: string
  bundleRoot?: string
  electronAppPath?: string
  signingIdentity: string
  entitlementsPath?: string
  notarization:
    | { profile: string }
    | {
        appleId: string
        password: string
        teamId: string
      }
  updateFeedUrl: string
  updateManifestPath?: string
  archivePath?: string
  commandRunner?: MacReleaseCommandRunner
  packaged?: MacPackagingResult
}

export type MacReleasePipelineResult = {
  packaging: MacPackagingResult
  archivePath: string
  updateFeed: MacReleaseUpdateFeed
  releaseManifest: MacReleaseManifest
}

export async function releaseMacApp(options: MacReleasePipelineOptions): Promise<MacReleasePipelineResult> {
  assertReleaseOptions(options)
  const entitlementsPath = resolveMacEntitlementsPath(options.entitlementsPath)
  assertMacEntitlementsFile(entitlementsPath)
  const commandRunner = options.commandRunner ?? runCommand
  const packaging =
    options.packaged ??
    (await packageMacApp({
      outDir: options.outDir,
      appDist: options.appDist,
      bundleRoot: options.bundleRoot,
      electronAppPath: options.electronAppPath,
      version: options.version,
    }))
  const archivePath = options.archivePath ?? path.join(path.dirname(packaging.bundle.bundlePath), "AX Code.app.zip")
  const updateManifestPath = options.updateManifestPath ?? path.join(path.dirname(archivePath), "ax-code-update.json")
  const initialReleaseManifest = cloneReleaseManifest(packaging.bundle.releaseManifest)
  try {
    const releaseManifest = writePassedReleaseManifest(
      packaging.bundle,
      createInstalledUpdateFeedLocator({
        updateFeedUrl: options.updateFeedUrl,
        updateManifestPath,
      }),
    )
    await signMacBundle(packaging.bundle, { signingIdentity: options.signingIdentity, entitlementsPath }, commandRunner)
    await verifyMacBundleSignature(packaging.bundle, commandRunner)
    await archiveMacBundle(packaging.bundle, archivePath, commandRunner)
    await notarizeMacArchive(packaging.bundle, archivePath, options, commandRunner)
    await validateMacNotarizationStaple(packaging.bundle, commandRunner)
    await archiveMacBundle(packaging.bundle, archivePath, commandRunner)
    const updateFeed = writeUpdateFeedManifest({
      bundle: packaging.bundle,
      archivePath,
      updateFeedUrl: options.updateFeedUrl,
      updateManifestPath,
    })
    return { packaging, archivePath, updateFeed, releaseManifest }
  } catch (error) {
    writeReleaseManifest(packaging.bundle, initialReleaseManifest)
    throw error
  }
}

function assertReleaseOptions(options: MacReleasePipelineOptions) {
  if (!options.signingIdentity) throw new Error("Mac release requires a code signing identity.")
  if (!options.updateFeedUrl) throw new Error("Mac release requires an update feed URL.")
  assertHttpsUrl(options.updateFeedUrl, "Mac release update feed URL")
  if ("profile" in options.notarization) {
    if (!options.notarization.profile) throw new Error("Mac release requires a notarytool keychain profile.")
    return
  }
  if (!options.notarization.appleId || !options.notarization.password || !options.notarization.teamId) {
    throw new Error("Mac release requires Apple ID, app-specific password, and team ID notarization credentials.")
  }
}

function assertHttpsUrl(value: string, label: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`)
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`)
}

async function signMacBundle(
  bundle: MacAppBundle,
  options: Pick<MacReleasePipelineOptions, "signingIdentity"> & { entitlementsPath: string },
  commandRunner: MacReleaseCommandRunner,
) {
  const args = [
    "--force",
    "--deep",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    options.signingIdentity,
    "--entitlements",
    options.entitlementsPath,
    bundle.bundlePath,
  ]
  await commandRunner({ command: "/usr/bin/codesign", args })
}

async function archiveMacBundle(bundle: MacAppBundle, archivePath: string, commandRunner: MacReleaseCommandRunner) {
  mkdirSync(path.dirname(archivePath), { recursive: true })
  await commandRunner({
    command: "/usr/bin/ditto",
    args: ["-c", "-k", "--keepParent", bundle.bundlePath, archivePath],
    cwd: path.dirname(bundle.bundlePath),
  })
  if (!existsSync(archivePath)) {
    throw new Error(`Mac release archive was not created: ${archivePath}`)
  }
}

async function verifyMacBundleSignature(bundle: MacAppBundle, commandRunner: MacReleaseCommandRunner) {
  await commandRunner({
    command: "/usr/bin/codesign",
    args: ["--verify", "--deep", "--strict", "--verbose=2", bundle.bundlePath],
  })
}

async function notarizeMacArchive(
  bundle: MacAppBundle,
  archivePath: string,
  options: Pick<MacReleasePipelineOptions, "notarization">,
  commandRunner: MacReleaseCommandRunner,
) {
  const notarizationArgs =
    "profile" in options.notarization
      ? ["notarytool", "submit", archivePath, "--keychain-profile", options.notarization.profile, "--wait"]
      : [
          "notarytool",
          "submit",
          archivePath,
          "--apple-id",
          options.notarization.appleId,
          "--password",
          options.notarization.password,
          "--team-id",
          options.notarization.teamId,
          "--wait",
        ]
  await commandRunner({ command: "/usr/bin/xcrun", args: notarizationArgs })
  await commandRunner({ command: "/usr/bin/xcrun", args: ["stapler", "staple", bundle.bundlePath] })
}

async function validateMacNotarizationStaple(bundle: MacAppBundle, commandRunner: MacReleaseCommandRunner) {
  await commandRunner({ command: "/usr/bin/xcrun", args: ["stapler", "validate", bundle.bundlePath] })
}

function createInstalledUpdateFeedLocator(input: { updateFeedUrl: string; updateManifestPath: string }): MacReleaseUpdateFeed {
  return {
    url: input.updateFeedUrl,
    manifestName: path.basename(input.updateManifestPath),
  }
}

function writeUpdateFeedManifest(input: {
  bundle: MacAppBundle
  archivePath: string
  updateFeedUrl: string
  updateManifestPath: string
}): MacReleaseUpdateFeed {
  const artifactName = path.basename(input.archivePath)
  const manifestName = path.basename(input.updateManifestPath)
  const artifactUrl = new URL(artifactName, withTrailingSlash(input.updateFeedUrl)).toString()
  const updateFeed: MacReleaseUpdateFeed = {
    url: input.updateFeedUrl,
    manifestName,
    manifestPath: input.updateManifestPath,
    artifactPath: input.archivePath,
    artifactName,
    artifactUrl,
    sha256: createHash("sha256").update(readFileSync(input.archivePath)).digest("hex"),
    sizeBytes: statSync(input.archivePath).size,
  }
  mkdirSync(path.dirname(input.updateManifestPath), { recursive: true })
  writeFileSync(
    input.updateManifestPath,
    JSON.stringify(
      {
        productName: input.bundle.releaseManifest.productName,
        version: input.bundle.releaseManifest.version,
        platform: "darwin",
        manifestName,
        artifactName,
        artifactUrl,
        sha256: updateFeed.sha256,
        sizeBytes: updateFeed.sizeBytes,
      },
      null,
      2,
    ),
  )
  return updateFeed
}

function writePassedReleaseManifest(bundle: MacAppBundle, updateFeed: MacReleaseUpdateFeed) {
  const releaseManifest: MacReleaseManifest = {
    ...bundle.releaseManifest,
    signed: true,
    notarized: true,
    updaterConfigured: true,
    updateFeed,
    gates: {
      signing: {
        configured: true,
        status: "passed",
        evidence: "codesign completed with hardened runtime and timestamp, then codesign --verify passed.",
      },
      notarization: {
        configured: true,
        status: "passed",
        evidence: "notarytool submit --wait completed, stapler staple completed, and stapler validate passed.",
      },
      updater: {
        configured: true,
        status: "passed",
        evidence: `Update feed locator configured for ${updateFeed.manifestName}.`,
      },
    },
  }
  writeReleaseManifest(bundle, releaseManifest)
  return releaseManifest
}

function writeReleaseManifest(bundle: MacAppBundle, releaseManifest: MacReleaseManifest) {
  writeFileSync(bundle.releaseManifestPath, JSON.stringify(releaseManifest, null, 2))
  bundle.releaseManifest = releaseManifest
}

function cloneReleaseManifest(releaseManifest: MacReleaseManifest) {
  return JSON.parse(JSON.stringify(releaseManifest)) as MacReleaseManifest
}

function withTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}

async function runCommand(input: MacReleaseCommand) {
  const proc = Bun.spawn([input.command, ...input.args], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${input.command} ${input.args.join(" ")}\n${stdout}${stderr}`.trim())
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      version: { type: "string" },
      "out-dir": { type: "string" },
      "app-dist": { type: "string" },
      "bundle-root": { type: "string" },
      "electron-app": { type: "string" },
      "signing-identity": { type: "string" },
      entitlements: { type: "string" },
      "notary-profile": { type: "string" },
      "apple-id": { type: "string" },
      "apple-password": { type: "string" },
      "apple-team-id": { type: "string" },
      "update-feed-url": { type: "string" },
      "update-manifest-path": { type: "string" },
      "archive-path": { type: "string" },
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
  if (!signingIdentity) throw new Error("Missing --signing-identity or APPLE_SIGNING_IDENTITY.")
  if (!updateFeedUrl) throw new Error("Missing --update-feed-url or AX_CODE_DESKTOP_UPDATE_FEED_URL.")
  const notarization = notaryProfile
    ? { profile: notaryProfile }
    : appleId && applePassword && appleTeamId
      ? { appleId, password: applePassword, teamId: appleTeamId }
      : undefined
  if (!notarization) {
    throw new Error(
      "Missing notarization credentials: set APPLE_NOTARY_PROFILE or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID.",
    )
  }
  const result = await releaseMacApp({
    version: values.version,
    outDir: values["out-dir"],
    appDist: values["app-dist"],
    bundleRoot: values["bundle-root"],
    electronAppPath: values["electron-app"],
    signingIdentity,
    entitlementsPath: values.entitlements,
    notarization,
    updateFeedUrl,
    updateManifestPath: values["update-manifest-path"],
    archivePath: values["archive-path"],
  })
  console.log(JSON.stringify(result, null, 2))
}
