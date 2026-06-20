
import childProcess from "child_process"
import { whichSync } from "./which"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { parseArgs } from "util"

export const ROOT = path.resolve(import.meta.dirname, "..")
export const AX_CODE_MINISIGN_PUBLIC_KEY = "RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A"
export const DEFAULT_MINISIGN_KEYCHAIN_SERVICE = "ax-code-minisign"
export const DEFAULT_MINISIGN_KEYCHAIN_ACCOUNT = "ax-code-release"
export const SIGN_RELEASE_ASSETS_SCRIPT = "script/sign-release-assets.ts"

export type SignReleaseOptions = {
  distDir: string
  secretKey: string
  publicKey: string
  files: string[]
  verifyOnly: boolean
  dryRun: boolean
  force: boolean
}

export function expandHome(input: string, home = os.homedir()) {
  if (input === "~") return home
  if (input.startsWith("~/")) return path.join(home, input.slice(2))
  return input
}

export function defaultKeyPaths(env: NodeJS.ProcessEnv = process.env, home = os.homedir()) {
  const keyDir = expandHome(env.AX_CODE_MINISIGN_KEY_DIR ?? "~/.minisign", home)
  return {
    secretKey: expandHome(env.AX_CODE_MINISIGN_SECRET_KEY ?? path.join(keyDir, "minisign.key"), home),
    publicKey: expandHome(env.AX_CODE_MINISIGN_PUBLIC_KEY ?? path.join(keyDir, "minisign.pub"), home),
  }
}

export function isReleaseArchive(file: string) {
  return file.endsWith(".tar.gz") || file.endsWith(".zip")
}

export function findReleaseAssets(distDir: string) {
  if (!fs.existsSync(distDir)) return []
  return fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isReleaseArchive(entry.name))
    .map((entry) => path.join(distDir, entry.name))
    .sort()
}

export function signaturePath(file: string) {
  return `${file}.minisig`
}

export function signReleaseAssetsCommand(args: readonly string[]) {
  return {
    command: "pnpm",
    args: ["exec", "tsx", SIGN_RELEASE_ASSETS_SCRIPT, ...args],
  }
}

export async function sha256File(file: string) {
  const hash = crypto.createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

export function trustedComment(file: string, digest: string) {
  return `AX Code release artifact: ${path.basename(file)}; sha256=${digest}`
}

export function parseSignReleaseArgs(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
): SignReleaseOptions & { help: boolean } {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dist-dir": { type: "string" },
      "key-dir": { type: "string" },
      "secret-key": { type: "string" },
      "public-key": { type: "string" },
      "verify-only": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", short: "f", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  const keyDir = parsed.values["key-dir"] ? expandHome(parsed.values["key-dir"], home) : undefined
  const defaults = keyDir
    ? {
        secretKey: path.join(keyDir, "minisign.key"),
        publicKey: path.join(keyDir, "minisign.pub"),
      }
    : defaultKeyPaths(env, home)

  const distDir = path.resolve(cwd, parsed.values["dist-dir"] ?? path.join(ROOT, "packages/ax-code/dist"))
  const files = parsed.positionals.map((file) => path.resolve(cwd, file))

  return {
    distDir,
    secretKey: path.resolve(cwd, expandHome(parsed.values["secret-key"] ?? defaults.secretKey, home)),
    publicKey: path.resolve(cwd, expandHome(parsed.values["public-key"] ?? defaults.publicKey, home)),
    files,
    verifyOnly: Boolean(parsed.values["verify-only"]),
    dryRun: Boolean(parsed.values["dry-run"]),
    force: Boolean(parsed.values.force),
    help: Boolean(parsed.values.help),
  }
}

function usage() {
  return `Usage:
  tsx script/sign-release-assets.ts [options] [file ...]

Options:
  --dist-dir <dir>      Directory to scan when no files are provided
                        (default: packages/ax-code/dist)
  --key-dir <dir>       Directory containing minisign.key and minisign.pub
                        (default: ~/.minisign)
  --secret-key <file>   Secret key path (default: ~/.minisign/minisign.key)
  --public-key <file>   Public key path (default: ~/.minisign/minisign.pub)
  --verify-only         Verify existing .minisig files without signing
  --dry-run             Print the release archives that would be processed
  -f, --force           Replace existing .minisig files before signing
  -h, --help            Show this help

Environment:
  AX_CODE_MINISIGN_KEY_DIR
  AX_CODE_MINISIGN_SECRET_KEY
  AX_CODE_MINISIGN_PUBLIC_KEY
  AX_CODE_MINISIGN_PASSWORD
  AX_CODE_MINISIGN_KEYCHAIN_SERVICE
  AX_CODE_MINISIGN_KEYCHAIN_ACCOUNT

Generate a password-protected local key:
  minisign -G -s ~/.minisign/minisign.key -p ~/.minisign/minisign.pub

Store the release key passphrase in macOS Keychain:
  security add-generic-password -U -a ax-code-release -s ax-code-minisign -w
`
}

function requireRegularFile(file: string, label: string) {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    throw new Error(`${label} not found: ${file}`)
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${file}`)
  return stat
}

export function readMinisignPublicKey(file: string) {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("RW"))
}

export function requirePinnedPublicKey(file: string) {
  const publicKey = readMinisignPublicKey(file)
  if (publicKey !== AX_CODE_MINISIGN_PUBLIC_KEY) {
    throw new Error(
      `Minisign public key does not match the pinned AX Code release key: ${file}. ` +
        "Set AX_CODE_MINISIGN_PUBLIC_KEY or --public-key to the matching key file.",
    )
  }
}

export function minisignPasswordFromKeychain(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "darwin") return undefined
  const service = env.AX_CODE_MINISIGN_KEYCHAIN_SERVICE ?? DEFAULT_MINISIGN_KEYCHAIN_SERVICE
  const account = env.AX_CODE_MINISIGN_KEYCHAIN_ACCOUNT ?? DEFAULT_MINISIGN_KEYCHAIN_ACCOUNT
  const result = childProcess.spawnSync("security", ["find-generic-password", "-w", "-s", service, "-a", account], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env,
  })
  if (result.status !== 0) return undefined
  const password = typeof result.stdout === "string" ? result.stdout.replace(/\r?\n$/, "") : ""
  return password.length > 0 ? password : undefined
}

export function minisignPassword(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  return env.AX_CODE_MINISIGN_PASSWORD ?? minisignPasswordFromKeychain(env, platform)
}

export function secretKeyPermissionIssue(file: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") return undefined
  const stat = requireRegularFile(file, "Secret key")
  if ((stat.mode & 0o077) !== 0) {
    return `Secret key permissions are too open: ${file}. Run: chmod 600 ${JSON.stringify(file)}`
  }
  return undefined
}

function requireSecretKey(file: string) {
  const issue = secretKeyPermissionIssue(file)
  if (issue) throw new Error(issue)
}

function runMinisign(args: string[], options: { dryRun: boolean; dryRunArgs?: string[] }) {
  const dryRunArgs = options.dryRunArgs ?? args
  if (options.dryRun) {
    console.log(`minisign ${dryRunArgs.map((arg) => JSON.stringify(arg)).join(" ")}`)
    return
  }

  const password = minisignPassword()
  const result = childProcess.spawnSync("minisign", args, {
    cwd: ROOT,
    stdio: password ? ["pipe", "inherit", "inherit"] : "inherit",
    env: process.env,
    input: password ? `${password}\n` : undefined,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`minisign exited with status ${result.status ?? "unknown"}`)
  }
}

export function releaseAssetsForOptions(options: SignReleaseOptions) {
  return options.files.length > 0 ? options.files : findReleaseAssets(options.distDir)
}

export function prepareSignaturePath(sig: string, options: { force: boolean; verifyOnly: boolean; dryRun: boolean }) {
  if (options.verifyOnly) {
    requireRegularFile(sig, "Signature")
    return
  }
  if (!fs.existsSync(sig)) return
  if (!options.force) {
    throw new Error(`Signature already exists: ${sig}. Pass --force to replace it.`)
  }
  if (!options.dryRun) fs.rmSync(sig)
}

async function main() {
  const options = parseSignReleaseArgs()
  if (options.help) {
    console.log(usage())
    return
  }

  if (!whichSync("minisign")) {
    throw new Error("minisign not found on PATH. Install it with `brew install minisign`.")
  }

  const assets = releaseAssetsForOptions(options)
  if (assets.length === 0) {
    throw new Error(`No release archives found. Build first, or pass files explicitly. Scanned: ${options.distDir}`)
  }

  requireRegularFile(options.publicKey, "Public key")
  requirePinnedPublicKey(options.publicKey)
  if (!options.verifyOnly) requireSecretKey(options.secretKey)

  for (const asset of assets) {
    requireRegularFile(asset, "Release archive")
    const sig = signaturePath(asset)
    prepareSignaturePath(sig, options)

    if (!options.verifyOnly) {
      const digest = await sha256File(asset)
      console.log(`Signing ${path.relative(ROOT, asset)}`)
      runMinisign(
        [
          "-S",
          "-s",
          options.secretKey,
          "-m",
          asset,
          "-x",
          sig,
          "-c",
          "AX Code minisign signature",
          "-t",
          trustedComment(asset, digest),
        ],
        {
          dryRun: options.dryRun,
          dryRunArgs: [
            "-S",
            "-s",
            "<secret-key>",
            "-m",
            asset,
            "-x",
            sig,
            "-c",
            "AX Code minisign signature",
            "-t",
            trustedComment(asset, digest),
          ],
        },
      )
    }

    console.log(`Verifying ${path.relative(ROOT, asset)}`)
    runMinisign(["-V", "-p", options.publicKey, "-m", asset, "-x", sig], { dryRun: options.dryRun })
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
