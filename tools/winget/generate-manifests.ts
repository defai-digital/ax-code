#!/usr/bin/env tsx
/** Generate Windows Package Manager manifests for the AX Code CLI release. */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const repository = "defai-digital/ax-code"
const publisher = "DEFAI"
const copyright = "Copyright (c) DEFAI Private Limited"

export type Args = {
  version: string
  out: string
  skipDownload: boolean
  tag: string
}

export function parseArgs(argv: string[]): Args {
  let version = ""
  let out = path.join(".tmp", "winget")
  let skipDownload = false
  let tag = ""

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--version" || arg === "-v") version = argv[++index] ?? ""
    else if (arg === "--out" || arg === "-o") out = argv[++index] ?? out
    else if (arg === "--tag") tag = argv[++index] ?? ""
    else if (arg === "--skip-download") skipDownload = true
    else if (arg === "--package" || arg === "-p") {
      const selected = argv[++index] ?? ""
      if (selected !== "cli") throw new Error("AX Code can generate only the CLI winget package")
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(
        "Usage: generate-manifests.ts --version <semver> [--package cli] [--tag <tag>] [--out <dir>] [--skip-download]",
      )
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  const normalizedVersion = version.replace(/^v/, "")
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalizedVersion)) {
    throw new Error("--version must be a semantic version")
  }
  return { version: normalizedVersion, out, skipDownload, tag: tag || `v${normalizedVersion}` }
}

async function sha256Url(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "ax-code-winget-manifest-generator" },
    redirect: "follow",
  })
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  return createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex")
    .toUpperCase()
}

function writeYaml(file: string, lines: string[]) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8")
}

export async function generateManifests(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const base = `https://github.com/${repository}/releases/download/${args.tag}`
  const assets = [
    { arch: "x64", file: "ax-code-windows-x64.zip" },
    { arch: "arm64", file: "ax-code-windows-arm64.zip" },
  ]
  const hashes = new Map<string, string>()
  for (const asset of assets) {
    hashes.set(asset.file, args.skipDownload ? "REPLACE_WITH_SHA256" : await sha256Url(`${base}/${asset.file}`))
  }

  const packageId = "DEFAI.AXCode"
  const output = path.resolve(args.out, "manifests", "d", "DEFAI", "AXCode", args.version)
  const repositoryUrl = `https://github.com/${repository}`

  writeYaml(path.join(output, `${packageId}.yaml`), [
    `PackageIdentifier: ${packageId}`,
    `PackageVersion: ${args.version}`,
    "DefaultLocale: en-US",
    "ManifestType: version",
    "ManifestVersion: 1.6.0",
  ])

  writeYaml(path.join(output, `${packageId}.locale.en-US.yaml`), [
    `PackageIdentifier: ${packageId}`,
    `PackageVersion: ${args.version}`,
    "PackageLocale: en-US",
    `Publisher: ${publisher}`,
    "PublisherUrl: https://github.com/defai-digital",
    `PublisherSupportUrl: ${repositoryUrl}/issues`,
    `Author: ${publisher}`,
    "PackageName: AX Code",
    `PackageUrl: ${repositoryUrl}`,
    "License: Apache-2.0",
    `LicenseUrl: ${repositoryUrl}/blob/main/LICENSE`,
    `Copyright: ${copyright}`,
    "ShortDescription: Local-first agent runtime CLI for software work",
    "Description: AX Code is a local-first coding-agent runtime for terminal sessions, headless automation, and application hosts.",
    "Moniker: ax-code",
    "Tags:",
    "  - ai",
    "  - developer-tools",
    "  - cli",
    "  - code-assistant",
    "ManifestType: defaultLocale",
    "ManifestVersion: 1.6.0",
  ])

  const installers = assets.flatMap((asset) => [
    `  - Architecture: ${asset.arch}`,
    "    InstallerType: zip",
    "    NestedInstallerType: portable",
    "    NestedInstallerFiles:",
    "      - RelativeFilePath: bin\\ax-code.cmd",
    "        PortableCommandAlias: ax-code",
    `    InstallerUrl: ${base}/${asset.file}`,
    `    InstallerSha256: ${hashes.get(asset.file)}`,
    "    ArchiveBinariesDependOnPath: true",
  ])

  writeYaml(path.join(output, `${packageId}.installer.yaml`), [
    `PackageIdentifier: ${packageId}`,
    `PackageVersion: ${args.version}`,
    "Platform:",
    "  - Windows.Desktop",
    "MinimumOSVersion: 10.0.17763.0",
    "InstallerType: zip",
    "Commands:",
    "  - ax-code",
    "ReleaseDate: " + new Date().toISOString().slice(0, 10),
    "Installers:",
    ...installers,
    "ManifestType: installer",
    "ManifestVersion: 1.6.0",
  ])

  return { output, tag: args.tag }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("generate-manifests.ts") || process.argv[1].endsWith("generate-manifests.js"))

if (isMain) {
  generateManifests()
    .then((result) => console.log(`Wrote AX Code CLI winget manifests to ${result.output}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
