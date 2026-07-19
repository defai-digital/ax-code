import childProcess from "child_process"
import { whichSync } from "./which"
import fs from "fs"
import os from "os"
import path from "path"
import { parseArgs } from "util"
import { AX_CODE_MINISIGN_PUBLIC_KEY_FILE, expandHome } from "./sign-release-assets"

export const ROOT = path.resolve(import.meta.dirname, "..")

export type PublishGithubReleaseOptions = {
  version: string
  tag: string
  repo: string
  assetDir?: string
  dryRun: boolean
  existingTag: boolean
  allowDirty: boolean
  allowNonMain: boolean
  skipWatch: boolean
  skipInstallSmoke: boolean
  installChannel?: "all" | "homebrew" | "windows"
}

type RunOptions = {
  capture?: boolean
  dryRun?: boolean
}

export function normalizeVersion(version: string) {
  return version.replace(/^v/, "")
}

export function defaultTag(version: string) {
  return `v${normalizeVersion(version)}`
}

export function isPrerelease(version: string) {
  return normalizeVersion(version).includes("-")
}

export function defaultInstallChannel(version: string): "all" | "windows" {
  return isPrerelease(version) ? "windows" : "all"
}

export function expectedReleaseArchives() {
  return ["ax-code-darwin-arm64.zip", "ax-code-windows-x64.zip", "ax-code-windows-arm64.zip"]
}

export function expectedReleaseSignatures() {
  return expectedReleaseArchives().map((asset) => `${asset}.minisig`)
}

export function expectedReleaseInstallerAssets() {
  return ["install.ps1"]
}

export function expectedReleaseInstallerSignatures() {
  return expectedReleaseInstallerAssets().map((asset) => `${asset}.minisig`)
}

export function expectedReleaseMetadataAssets() {
  return ["ax-minisign.pub"]
}

export function missingReleaseAssets(
  actual: Iterable<string>,
  expected = [
    ...expectedReleaseArchives(),
    ...expectedReleaseSignatures(),
    ...expectedReleaseInstallerAssets(),
    ...expectedReleaseInstallerSignatures(),
    ...expectedReleaseMetadataAssets(),
  ],
) {
  const found = new Set(actual)
  return expected.filter((asset) => !found.has(asset))
}

export function readPackageVersion(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "packages/ax-code/package.json"), "utf8")) as {
    version?: unknown
  }
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("packages/ax-code/package.json does not contain a valid version")
  }
  return pkg.version
}

export function trackedInternalFiles(root = ROOT) {
  const result = childProcess.spawnSync("git", ["ls-files", "ax-internal"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
    throw new Error(`git ls-files ax-internal exited with status ${result.status}${stderr ? `: ${stderr}` : ""}`)
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function trackedInternalPrivacyIssue(files: readonly string[]) {
  if (files.length === 0) return undefined
  const sample = files.slice(0, 5).join(", ")
  const suffix = files.length > 5 ? `, and ${files.length - 5} more` : ""
  return `ax-internal files are tracked: ${sample}${suffix}. Remove them from git index before publishing.`
}

export function assertNoTrackedInternalFiles(root = ROOT) {
  const issue = trackedInternalPrivacyIssue(trackedInternalFiles(root))
  if (issue) throw new Error(issue)
}

export function parsePublishGithubReleaseArgs(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
): PublishGithubReleaseOptions & { help: boolean } {
  const packageVersion = readPackageVersion()
  const parsed = parseArgs({
    args,
    options: {
      version: { type: "string", short: "v", default: packageVersion },
      tag: { type: "string" },
      repo: { type: "string", default: env.GH_REPO ?? "defai-digital/ax-code" },
      "asset-dir": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "existing-tag": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
      "allow-non-main": { type: "boolean", default: false },
      "skip-watch": { type: "boolean", default: false },
      "skip-install-smoke": { type: "boolean", default: false },
      "install-channel": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  const version = normalizeVersion(parsed.values.version ?? packageVersion)
  const channel = parsed.values["install-channel"]
  if (channel && channel !== "all" && channel !== "homebrew" && channel !== "windows") {
    throw new Error("--install-channel must be one of: all, homebrew, windows")
  }

  return {
    version,
    tag: parsed.values.tag ?? defaultTag(version),
    repo: parsed.values.repo ?? env.GH_REPO ?? "defai-digital/ax-code",
    assetDir: parsed.values["asset-dir"] ? path.resolve(cwd, expandHome(parsed.values["asset-dir"], home)) : undefined,
    dryRun: Boolean(parsed.values["dry-run"]),
    existingTag: Boolean(parsed.values["existing-tag"]),
    allowDirty: Boolean(parsed.values["allow-dirty"]),
    allowNonMain: Boolean(parsed.values["allow-non-main"]),
    skipWatch: Boolean(parsed.values["skip-watch"]),
    skipInstallSmoke: Boolean(parsed.values["skip-install-smoke"]),
    installChannel: channel as PublishGithubReleaseOptions["installChannel"],
    help: Boolean(parsed.values.help),
  }
}

function usage() {
  return `Usage:
  pnpm run publish:github -- [options]

Options:
  -v, --version <version>     Version to publish (default: packages/ax-code/package.json)
  --tag <tag>                 Git tag to publish (default: v<version>)
  --repo <owner/repo>         GitHub repo (default: defai-digital/ax-code)
  --asset-dir <dir>           Directory used for downloaded release assets
  --existing-tag              Continue from an already-pushed release tag
  --allow-dirty               Allow a dirty worktree
  --allow-non-main            Allow publishing from a non-main branch
  --skip-watch                Do not watch the tag-driven release workflow
  --skip-install-smoke        Do not dispatch install-matrix-smoke.yml
  --install-channel <channel> Install smoke channel: all, homebrew, windows
  --dry-run                   Print commands without mutating git or GitHub state
  -h, --help                  Show this help

Default flow:
  preflight -> create and push tag -> watch release.yml -> download release assets
  -> independently verify the complete Minisign asset set
  -> dispatch and watch install-matrix-smoke.yml
`
}

function run(command: string, args: string[], options: RunOptions = {}) {
  if (options.dryRun) {
    console.log([command, ...args].map((arg) => JSON.stringify(arg)).join(" "))
    return ""
  }

  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}${stderr ? `: ${stderr}` : ""}`)
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : ""
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function commandExists(command: string) {
  return Boolean(whichSync(command))
}

function requireCommand(command: string) {
  if (!commandExists(command)) throw new Error(`${command} not found on PATH`)
}

function ensurePreflight(options: PublishGithubReleaseOptions) {
  requireCommand("git")
  requireCommand("gh")
  requireCommand("minisign")

  const packageVersion = readPackageVersion()
  if (packageVersion !== options.version) {
    throw new Error(`Version mismatch: packages/ax-code is ${packageVersion}, requested ${options.version}`)
  }

  assertNoTrackedInternalFiles()

  if (!options.allowDirty) {
    const status = run("git", ["status", "--porcelain"], { capture: true })
    if (status) throw new Error("Worktree is dirty. Commit or stash changes, or pass --allow-dirty.")
  }

  if (!options.allowNonMain) {
    const branch = run("git", ["branch", "--show-current"], { capture: true })
    if (branch !== "main")
      throw new Error(`Refusing to publish from ${branch || "detached HEAD"}. Pass --allow-non-main to override.`)
  }
}

function tagExists(tag: string, options: PublishGithubReleaseOptions) {
  if (options.dryRun) {
    console.log(`Would check whether tag ${tag} exists locally or on origin`)
    return { local: false, remote: false }
  }
  const local =
    childProcess.spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
      cwd: ROOT,
      stdio: "ignore",
    }).status === 0
  const remote =
    childProcess.spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
      cwd: ROOT,
      stdio: "ignore",
    }).status === 0
  if (!options.existingTag && (local || remote)) {
    throw new Error(`Tag ${tag} already exists. Pass --existing-tag to continue from it.`)
  }
  if (options.existingTag && !local && !remote) {
    throw new Error(`--existing-tag was passed, but ${tag} does not exist locally or on origin.`)
  }
  return { local, remote }
}

function createAndPushTag(options: PublishGithubReleaseOptions) {
  if (options.existingTag) {
    console.log(`Using existing tag ${options.tag}`)
    return
  }
  run("git", ["tag", "-a", options.tag, "-m", `Release ${options.tag}`], { dryRun: options.dryRun })
  run("git", ["push", "origin", options.tag], { dryRun: options.dryRun })
}

function latestWorkflowRunID(workflow: string, branch: string | undefined, options: PublishGithubReleaseOptions) {
  const args = ["run", "list", "--repo", options.repo, "--workflow", workflow, "--limit", "1", "--json", "databaseId"]
  if (branch) args.push("--branch", branch)
  args.push("--jq", ".[0].databaseId")
  return run("gh", args, { capture: true, dryRun: options.dryRun })
}

function waitForWorkflowRunID(
  workflow: string,
  branch: string | undefined,
  label: string,
  options: PublishGithubReleaseOptions,
) {
  if (options.dryRun) return latestWorkflowRunID(workflow, branch, options) || "<run-id>"

  for (let attempt = 1; attempt <= 60; attempt++) {
    const runID = latestWorkflowRunID(workflow, branch, options)
    if (runID) return runID
    console.log(`Waiting for ${label} workflow run to appear (${attempt}/60)...`)
    sleep(5_000)
  }

  throw new Error(`Could not find ${label} workflow run after waiting 5 minutes`)
}

function watchWorkflow(
  workflow: string,
  branch: string | undefined,
  label: string,
  options: PublishGithubReleaseOptions,
) {
  if (options.skipWatch) {
    console.log(`Skipping ${label} workflow watch`)
    return
  }
  const runID = waitForWorkflowRunID(workflow, branch, label, options)
  run("gh", ["run", "watch", runID, "--repo", options.repo, "--exit-status"], { dryRun: options.dryRun })
}

function releaseAssetDir(options: PublishGithubReleaseOptions) {
  if (options.assetDir) {
    fs.mkdirSync(options.assetDir, { recursive: true })
    return options.assetDir
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), `ax-code-${options.tag}-release-`))
}

function listReleaseAssetNames(options: PublishGithubReleaseOptions) {
  const out = run(
    "gh",
    ["release", "view", options.tag, "--repo", options.repo, "--json", "assets", "--jq", ".assets[].name"],
    { capture: true, dryRun: options.dryRun },
  )
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function requireReleaseAssets(options: PublishGithubReleaseOptions) {
  if (options.dryRun) return
  const missing = missingReleaseAssets(listReleaseAssetNames(options))
  if (missing.length > 0) throw new Error(`GitHub release ${options.tag} is missing assets: ${missing.join(", ")}`)
}

function signableAssetPaths(assetDir: string) {
  return [...expectedReleaseArchives(), ...expectedReleaseInstallerAssets()].map((name) => path.join(assetDir, name))
}

function downloadReleaseAssets(options: PublishGithubReleaseOptions, assetDir: string) {
  run("gh", ["release", "download", options.tag, "--repo", options.repo, "--dir", assetDir, "--clobber"], {
    dryRun: options.dryRun,
  })
  if (options.dryRun) return
  const missing = missingReleaseAssets(fs.readdirSync(assetDir))
  if (missing.length > 0) throw new Error(`Downloaded release is missing expected assets: ${missing.join(", ")}`)
}

function verifyDownloadedReleaseAssets(options: PublishGithubReleaseOptions, assetDir: string) {
  if (options.dryRun) return
  const downloadedPublicKey = path.join(assetDir, expectedReleaseMetadataAssets()[0])
  const committedPublicKey = path.join(ROOT, AX_CODE_MINISIGN_PUBLIC_KEY_FILE)
  if (fs.readFileSync(downloadedPublicKey, "utf8") !== fs.readFileSync(committedPublicKey, "utf8")) {
    throw new Error(`Downloaded ax-minisign.pub does not match ${AX_CODE_MINISIGN_PUBLIC_KEY_FILE}`)
  }
  for (const asset of signableAssetPaths(assetDir)) {
    run("minisign", ["-V", "-p", committedPublicKey, "-m", asset, "-x", `${asset}.minisig`])
  }
}

function dispatchInstallSmoke(options: PublishGithubReleaseOptions) {
  if (options.skipInstallSmoke) {
    console.log("Skipping install matrix smoke")
    return
  }
  const channel = options.installChannel ?? defaultInstallChannel(options.version)
  run(
    "gh",
    [
      "workflow",
      "run",
      "install-matrix-smoke.yml",
      "--repo",
      options.repo,
      "-f",
      `version=${options.version}`,
      "-f",
      `channel=${channel}`,
    ],
    { dryRun: options.dryRun },
  )
  watchWorkflow("install-matrix-smoke.yml", undefined, "install matrix smoke", options)
}

export function publishPlan(options: PublishGithubReleaseOptions) {
  const channel = options.installChannel ?? defaultInstallChannel(options.version)
  return [
    `publish ${options.tag} to ${options.repo}`,
    options.existingTag ? "continue from existing tag" : "create and push annotated release tag",
    options.skipWatch ? "skip release workflow watch" : "watch release.yml",
    `independently verify release signatures with ${AX_CODE_MINISIGN_PUBLIC_KEY_FILE}`,
    options.skipInstallSmoke ? "skip install matrix smoke" : `dispatch install-matrix-smoke.yml channel=${channel}`,
  ]
}

async function main() {
  const options = parsePublishGithubReleaseArgs()
  if (options.help) {
    console.log(usage())
    return
  }

  console.log(
    publishPlan(options)
      .map((step) => `- ${step}`)
      .join("\n"),
  )
  ensurePreflight(options)
  tagExists(options.tag, options)
  createAndPushTag(options)
  // release.yml is triggered by tag pushes, not branches. Passing the tag name
  // as --branch would filter out the run and the watch would time out.
  watchWorkflow("release.yml", undefined, "release", options)

  const assetDir = releaseAssetDir(options)
  console.log(`Using release asset directory: ${assetDir}`)
  downloadReleaseAssets(options, assetDir)
  verifyDownloadedReleaseAssets(options, assetDir)
  requireReleaseAssets(options)
  dispatchInstallSmoke(options)
  console.log(`Published ${options.tag} to ${options.repo}`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
