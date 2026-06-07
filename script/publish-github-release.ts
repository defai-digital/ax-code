#!/usr/bin/env bun

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { parseArgs } from "util"
import { AX_CODE_MINISIGN_PUBLIC_KEY, expandHome, secretKeyPermissionIssue } from "./sign-release-assets"

export const ROOT = path.resolve(import.meta.dir, "..")

export type PublishGithubReleaseOptions = {
  version: string
  tag: string
  repo: string
  keyDir: string
  assetDir?: string
  dryRun: boolean
  existingTag: boolean
  allowDirty: boolean
  allowNonMain: boolean
  skipWatch: boolean
  skipSign: boolean
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

export function missingReleaseAssets(
  actual: Iterable<string>,
  expected = [...expectedReleaseArchives(), ...expectedReleaseSignatures()],
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

export function parsePublishGithubReleaseArgs(
  args = Bun.argv.slice(2),
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
      "key-dir": { type: "string", default: env.AX_CODE_MINISIGN_KEY_DIR ?? "~/signkey" },
      "asset-dir": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "existing-tag": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
      "allow-non-main": { type: "boolean", default: false },
      "skip-watch": { type: "boolean", default: false },
      "skip-sign": { type: "boolean", default: false },
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
    keyDir: path.resolve(cwd, expandHome(parsed.values["key-dir"] ?? "~/signkey", home)),
    assetDir: parsed.values["asset-dir"] ? path.resolve(cwd, expandHome(parsed.values["asset-dir"], home)) : undefined,
    dryRun: Boolean(parsed.values["dry-run"]),
    existingTag: Boolean(parsed.values["existing-tag"]),
    allowDirty: Boolean(parsed.values["allow-dirty"]),
    allowNonMain: Boolean(parsed.values["allow-non-main"]),
    skipWatch: Boolean(parsed.values["skip-watch"]),
    skipSign: Boolean(parsed.values["skip-sign"]),
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
  --key-dir <dir>             Minisign key directory (default: ~/signkey)
  --asset-dir <dir>           Directory used for downloaded release assets
  --existing-tag              Continue from an already-pushed release tag
  --allow-dirty               Allow a dirty worktree
  --allow-non-main            Allow publishing from a non-main branch
  --skip-watch                Do not watch the tag-driven release workflow
  --skip-sign                 Do not sign or upload .minisig files
  --skip-install-smoke        Do not dispatch install-matrix-smoke.yml
  --install-channel <channel> Install smoke channel: all, homebrew, windows
  --dry-run                   Print commands without mutating git or GitHub state
  -h, --help                  Show this help

Default flow:
  preflight -> create and push tag -> watch release.yml -> download release assets
  -> minisign archives -> upload .minisig assets -> verify release asset set
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
  return Boolean(Bun.which(command))
}

function requireCommand(command: string) {
  if (!commandExists(command)) throw new Error(`${command} not found on PATH`)
}

function ensurePreflight(options: PublishGithubReleaseOptions) {
  requireCommand("git")
  requireCommand("gh")
  if (!options.skipSign) requireCommand("minisign")

  const packageVersion = readPackageVersion()
  if (packageVersion !== options.version) {
    throw new Error(`Version mismatch: packages/ax-code is ${packageVersion}, requested ${options.version}`)
  }

  if (!options.allowDirty) {
    const status = run("git", ["status", "--porcelain"], { capture: true })
    if (status) throw new Error("Worktree is dirty. Commit or stash changes, or pass --allow-dirty.")
  }

  if (!options.allowNonMain) {
    const branch = run("git", ["branch", "--show-current"], { capture: true })
    if (branch !== "main")
      throw new Error(`Refusing to publish from ${branch || "detached HEAD"}. Pass --allow-non-main to override.`)
  }

  if (!options.skipSign) {
    const secretKey = path.join(options.keyDir, "ax-code.sec")
    const publicKey = path.join(options.keyDir, "ax-code.pub")
    if (!fs.existsSync(publicKey)) throw new Error(`Minisign public key not found: ${publicKey}`)
    const actualPublicKey = fs
      .readFileSync(publicKey, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("RW"))
    if (actualPublicKey !== AX_CODE_MINISIGN_PUBLIC_KEY) {
      throw new Error(`Minisign public key does not match the pinned AX Code release key: ${publicKey}`)
    }
    const issue = secretKeyPermissionIssue(secretKey)
    if (issue) throw new Error(issue)
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
  const expected = options.skipSign
    ? expectedReleaseArchives()
    : [...expectedReleaseArchives(), ...expectedReleaseSignatures()]
  const missing = missingReleaseAssets(listReleaseAssetNames(options), expected)
  if (missing.length > 0) throw new Error(`GitHub release ${options.tag} is missing assets: ${missing.join(", ")}`)
}

function archivePaths(assetDir: string) {
  return expectedReleaseArchives().map((name) => path.join(assetDir, name))
}

function downloadReleaseArchives(options: PublishGithubReleaseOptions, assetDir: string) {
  run(
    "gh",
    [
      "release",
      "download",
      options.tag,
      "--repo",
      options.repo,
      "--dir",
      assetDir,
      "--clobber",
      "--pattern",
      "*.zip",
      "--pattern",
      "*.tar.gz",
    ],
    { dryRun: options.dryRun },
  )
  if (options.dryRun) return
  const missing = archivePaths(assetDir).filter((file) => !fs.existsSync(file))
  if (missing.length > 0)
    throw new Error(`Downloaded release is missing expected archives: ${missing.map(path.basename).join(", ")}`)
}

function signAndUpload(options: PublishGithubReleaseOptions, assetDir: string) {
  if (options.skipSign) {
    console.log("Skipping minisign signing")
    return
  }

  const archives = archivePaths(assetDir)
  run("bun", ["run", "script/sign-release-assets.ts", "--key-dir", options.keyDir, ...archives], {
    dryRun: options.dryRun,
  })
  const signatures = archives.map((asset) => `${asset}.minisig`)
  run("gh", ["release", "upload", options.tag, "--repo", options.repo, ...signatures, "--clobber"], {
    dryRun: options.dryRun,
  })
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
    options.skipSign
      ? "skip minisign signatures"
      : `sign release archives with ${path.join(options.keyDir, "ax-code.sec")}`,
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
  watchWorkflow("release.yml", options.tag, "release", options)

  const assetDir = releaseAssetDir(options)
  console.log(`Using release asset directory: ${assetDir}`)
  downloadReleaseArchives(options, assetDir)
  signAndUpload(options, assetDir)
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
