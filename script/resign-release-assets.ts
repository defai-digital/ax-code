#!/usr/bin/env bun

import childProcess from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { parseArgs } from "util"
import { expandHome, signaturePath } from "./sign-release-assets"
import {
  ROOT,
  expectedReleaseArchives,
  expectedReleaseSignatures,
  missingReleaseAssets,
} from "./publish-github-release"

export type ResignOptions = {
  repo: string
  tags: string[]
  allReleases: boolean
  keyDir: string
  secretKey: string
  publicKey: string
  assetDir?: string
  skipUpload: boolean
  dryRun: boolean
  yes: boolean
}

type RunOptions = { capture?: boolean; dryRun?: boolean }

export function listAllReleaseTags(repo: string): string[] {
  const result = childProcess.spawnSync(
    "gh",
    ["release", "list", "--repo", repo, "--exclude-drafts", "--json", "tagName", "--jq", ".[].tagName"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
    throw new Error(`gh release list exited with status ${result.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`)
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function listReleaseAssetNames(tag: string, repo: string): string[] {
  const result = childProcess.spawnSync(
    "gh",
    ["release", "view", tag, "--repo", repo, "--json", "assets", "--jq", ".assets[].name"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
    throw new Error(
      `gh release view ${tag} exited with status ${result.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
    )
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function resolveTags(options: ResignOptions): string[] {
  if (options.allReleases) return listAllReleaseTags(options.repo)
  return options.tags
}

export function archivePaths(assetDir: string): string[] {
  return expectedReleaseArchives().map((name) => path.join(assetDir, name))
}

export function signaturePaths(assetDir: string): string[] {
  return archivePaths(assetDir).map(signaturePath)
}

export function resignPlan(options: ResignOptions, tags: string[]): string[] {
  return [
    `re-sign ${tags.length} release tag(s) against ${options.repo}`,
    `signing key: ${options.secretKey}`,
    options.skipUpload
      ? "skip re-uploading .minisig assets (sign + verify only)"
      : "re-upload .minisig assets with --clobber",
    options.dryRun
      ? "dry-run: no downloads, signing, or uploads"
      : "destructive: will overwrite published .minisig assets",
  ]
}

export function parseResignArgs(
  args = Bun.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
): ResignOptions & { help: boolean } {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      tag: { type: "string", multiple: true },
      all: { type: "boolean", default: false },
      repo: { type: "string", default: env.GH_REPO ?? "defai-digital/ax-code" },
      "key-dir": { type: "string", default: env.AX_CODE_MINISIGN_KEY_DIR ?? "~/signkey" },
      "secret-key": { type: "string" },
      "public-key": { type: "string" },
      "asset-dir": { type: "string" },
      "skip-upload": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  const keyDir = path.resolve(cwd, expandHome(parsed.values["key-dir"]!, home))
  const normalizeTag = (tag: string) => (tag.startsWith("v") ? tag : `v${tag}`)
  const rawTags = [...(parsed.values.tag ?? []), ...parsed.positionals]

  return {
    repo: parsed.values.repo ?? env.GH_REPO ?? "defai-digital/ax-code",
    tags: rawTags.map(normalizeTag),
    allReleases: Boolean(parsed.values.all),
    keyDir,
    secretKey: path.resolve(cwd, expandHome(parsed.values["secret-key"] ?? path.join(keyDir, "ax-code.sec"), home)),
    publicKey: path.resolve(cwd, expandHome(parsed.values["public-key"] ?? path.join(keyDir, "ax-code.pub"), home)),
    assetDir: parsed.values["asset-dir"] ? path.resolve(cwd, expandHome(parsed.values["asset-dir"], home)) : undefined,
    skipUpload: Boolean(parsed.values["skip-upload"]),
    dryRun: Boolean(parsed.values["dry-run"]),
    yes: Boolean(parsed.values.yes),
    help: Boolean(parsed.values.help),
  }
}

function usage() {
  return `Usage:
  bun run script/resign-release-assets.ts [options] [tag ...]

Re-sign already-published release archives with the current minisign key and
re-upload the .minisig assets. Use after a release signing key rotation so
historical releases verify against the pinned public key.

Options:
  --tag <tag>           Release tag to re-sign (repeatable). Leading "v" optional.
  --all                 Re-sign every non-draft published release.
  --repo <owner/repo>   GitHub repo (default: defai-digital/ax-code)
  --key-dir <dir>       Directory with ax-code.sec and ax-code.pub (default: ~/signkey)
  --secret-key <file>   Secret key path (default: <key-dir>/ax-code.sec)
  --public-key <file>   Public key path (default: <key-dir>/ax-code.pub)
  --asset-dir <dir>     Directory used for downloaded release assets
  --skip-upload         Sign and verify locally, but do not re-upload .minisig files
  --dry-run             Print commands without downloading, signing, or uploading
  --yes                 Skip the destructive-action confirmation prompt
  -h, --help            Show this help

Environment:
  GH_REPO
  AX_CODE_MINISIGN_KEY_DIR

The current minisign public key must match the pinned key enforced by
script/sign-release-assets.ts. Signing is delegated to that script so the
pinned-key check, secret-key permission check, and post-sign verification all
apply. Requires the gh CLI and minisign on PATH.
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
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
    )
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : ""
}

function requireCommand(command: string) {
  if (!Bun.which(command)) throw new Error(`${command} not found on PATH`)
}

function requireKeyFiles(options: ResignOptions) {
  if (!fs.existsSync(options.secretKey)) throw new Error(`Secret key not found: ${options.secretKey}`)
  if (!fs.existsSync(options.publicKey)) throw new Error(`Public key not found: ${options.publicKey}`)
}

function confirmDestructive(options: ResignOptions, tags: string[]): boolean {
  if (options.yes || options.dryRun || options.skipUpload) return true
  process.stdout.write(
    `This will overwrite published .minisig assets for ${tags.length} release(s): ${tags.join(", ")}.\nContinue? [y/N] `,
  )
  const answer = childProcess.spawnSync("read", ["line"], { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" })
  const reply = typeof answer.stdout === "string" ? answer.stdout.trim().toLowerCase() : ""
  return reply === "y" || reply === "yes"
}

function downloadArchives(tag: string, options: ResignOptions, assetDir: string) {
  run(
    "gh",
    [
      "release",
      "download",
      tag,
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
  if (missing.length > 0) {
    throw new Error(`${tag} is missing expected archives: ${missing.map(path.basename).join(", ")}`)
  }
}

function signArchives(tag: string, options: ResignOptions, assetDir: string) {
  const archives = archivePaths(assetDir)
  run(
    "bun",
    [
      "run",
      "script/sign-release-assets.ts",
      "--secret-key",
      options.secretKey,
      "--public-key",
      options.publicKey,
      "--force",
      ...archives,
    ],
    { dryRun: options.dryRun },
  )
}

function uploadSignatures(tag: string, options: ResignOptions, assetDir: string) {
  if (options.skipUpload) {
    console.log(`Skipping .minisig upload for ${tag}`)
    return
  }
  const sigs = signaturePaths(assetDir)
  run("gh", ["release", "upload", tag, "--repo", options.repo, "--clobber", ...sigs], { dryRun: options.dryRun })
}

function verifyRemoteAssets(tag: string, options: ResignOptions) {
  if (options.dryRun) return
  const expected = [...expectedReleaseArchives(), ...expectedReleaseSignatures()]
  const missing = missingReleaseAssets(listReleaseAssetNames(tag, options.repo), expected)
  if (missing.length > 0) {
    throw new Error(`${tag} is still missing assets after re-sign: ${missing.join(", ")}`)
  }
}

async function main() {
  const options = parseResignArgs()
  if (options.help) {
    console.log(usage())
    return
  }

  requireCommand("gh")
  requireCommand("minisign")

  if (options.allReleases && options.tags.length > 0) {
    throw new Error("Pass either --all or explicit tags, not both.")
  }
  if (!options.allReleases && options.tags.length === 0) {
    throw new Error("No tags specified. Pass --tag <tag>, positional tags, or --all.")
  }

  requireKeyFiles(options)

  const tags = resolveTags(options)
  if (tags.length === 0) throw new Error(`No published releases found on ${options.repo}.`)

  console.log(
    resignPlan(options, tags)
      .map((step) => `- ${step}`)
      .join("\n"),
  )

  if (!confirmDestructive(options, tags)) {
    console.log("Aborted.")
    return
  }

  for (const tag of tags) {
    const assetDir = options.assetDir ?? fs.mkdtempSync(path.join(os.tmpdir(), `ax-code-resign-${tag}-`))
    console.log(`\n=== ${tag} (${assetDir}) ===`)
    downloadArchives(tag, options, assetDir)
    signArchives(tag, options, assetDir)
    uploadSignatures(tag, options, assetDir)
    verifyRemoteAssets(tag, options)
    console.log(`Re-signed ${tag}.`)
  }

  console.log(`\nDone. Re-signed ${tags.length} release(s) on ${options.repo}.`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
