#!/usr/bin/env tsx
/**
 * Generate Windows Package Manager (winget) manifests for a published AX Code release.
 *
 * Usage:
 *   pnpm exec tsx tools/winget/generate-manifests.ts --version 7.1.0
 *   pnpm exec tsx tools/winget/generate-manifests.ts --version v7.1.0 --out .tmp/winget
 *
 * Fetches GitHub release assets, computes SHA-256, and writes manifest folders for:
 *   - DEFAI.AXCode.Desktop (NSIS installers, x64 + arm64)
 *   - DEFAI.AXCode (CLI zip portable, x64 + arm64)
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const REPO = "defai-digital/ax-code"
const PUBLISHER = "DEFAI"
const COPYRIGHT = "Copyright (c) DEFAI Private Limited"
const LICENSE = "Apache-2.0"
const LICENSE_URL = "https://github.com/defai-digital/ax-code/blob/main/LICENSE"
const PACKAGE_URL = "https://github.com/defai-digital/ax-code"
const PUBLISHER_URL = "https://github.com/defai-digital"
const SUPPORT_URL = "https://github.com/defai-digital/ax-code/issues"
const TAGS = ["ai", "developer-tools", "cli", "code-assistant"]

type Args = {
  version: string
  out: string
  skipDownload: boolean
}

function parseArgs(argv: string[]): Args {
  let version = ""
  let out = path.join(".tmp", "winget")
  let skipDownload = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--version" || arg === "-v") {
      version = argv[++i] ?? ""
    } else if (arg === "--out" || arg === "-o") {
      out = argv[++i] ?? out
    } else if (arg === "--skip-download") {
      skipDownload = true
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: generate-manifests.ts --version <semver> [--out <dir>]`)
      process.exit(0)
    }
  }
  if (!version) {
    throw new Error("--version is required (e.g. 7.1.0)")
  }
  return { version: version.replace(/^v/, ""), out, skipDownload }
}

async function sha256Url(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ax-code-winget-manifest-generator" },
    redirect: "follow",
  })
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return createHash("sha256").update(buf).digest("hex").toUpperCase()
}

function yamlEscape(value: string): string {
  if (/[:#{}[\],&*!|>'"%@`]/.test(value) || value.includes("\n")) {
    return JSON.stringify(value)
  }
  return value
}

function writeYaml(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content.endsWith("\n") ? content : content + "\n", "utf8")
}

function packageLocale(opts: {
  packageId: string
  packageVersion: string
  packageName: string
  shortDescription: string
  description: string
  moniker: string
}): string {
  return [
    `PackageIdentifier: ${opts.packageId}`,
    `PackageVersion: ${opts.packageVersion}`,
    "PackageLocale: en-US",
    `Publisher: ${PUBLISHER}`,
    `PublisherUrl: ${PUBLISHER_URL}`,
    `PublisherSupportUrl: ${SUPPORT_URL}`,
    `Author: ${PUBLISHER}`,
    `PackageName: ${opts.packageName}`,
    `PackageUrl: ${PACKAGE_URL}`,
    `License: ${LICENSE}`,
    `LicenseUrl: ${LICENSE_URL}`,
    `Copyright: ${COPYRIGHT}`,
    `ShortDescription: ${yamlEscape(opts.shortDescription)}`,
    `Description: ${yamlEscape(opts.description)}`,
    `Moniker: ${opts.moniker}`,
    `Tags:`,
    ...TAGS.map((t) => `  - ${t}`),
    "ManifestType: defaultLocale",
    "ManifestVersion: 1.6.0",
  ].join("\n")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const version = args.version
  const tag = `v${version}`
  const releaseBase = `https://github.com/${REPO}/releases/download/${tag}`

  const desktopAssets = [
    { arch: "x64", file: `AX-Code-${version}-win-x64.exe`, installerType: "nullsoft" as const },
    { arch: "arm64", file: `AX-Code-${version}-win-arm64.exe`, installerType: "nullsoft" as const },
  ]
  const cliAssets = [
    { arch: "x64", file: `ax-code-windows-x64.zip`, installerType: "zip" as const },
    { arch: "arm64", file: `ax-code-windows-arm64.zip`, installerType: "zip" as const },
  ]

  console.log(`Generating winget manifests for ${tag}`)
  console.log(`Output: ${args.out}`)

  const hashes = new Map<string, string>()
  if (!args.skipDownload) {
    for (const asset of [...desktopAssets, ...cliAssets]) {
      const url = `${releaseBase}/${asset.file}`
      process.stdout.write(`  hashing ${asset.file} ... `)
      const hash = await sha256Url(url)
      hashes.set(asset.file, hash)
      console.log(hash.slice(0, 12) + "…")
    }
  } else {
    for (const asset of [...desktopAssets, ...cliAssets]) {
      hashes.set(asset.file, "REPLACE_WITH_SHA256")
    }
  }

  // ── Desktop ────────────────────────────────────────────────────────────
  const desktopId = "DEFAI.AXCode.Desktop"
  const desktopDir = path.join(args.out, "manifests", "d", "DEFAI", "AXCode", "Desktop", version)

  writeYaml(
    path.join(desktopDir, `${desktopId}.yaml`),
    [
      `PackageIdentifier: ${desktopId}`,
      `PackageVersion: ${version}`,
      "DefaultLocale: en-US",
      "ManifestType: version",
      "ManifestVersion: 1.6.0",
    ].join("\n"),
  )

  writeYaml(
    path.join(desktopDir, `${desktopId}.locale.en-US.yaml`),
    packageLocale({
      packageId: desktopId,
      packageVersion: version,
      packageName: "AX Code Desktop",
      shortDescription: "Desktop workspace for the AX Code agent runtime",
      description:
        "AX Code Desktop is the graphical workspace for AX Code: chat sessions, file review, diffs, Git, terminals, and multi-agent workflows. Requires the AX Code CLI for coding sessions.",
      moniker: "ax-code-desktop",
    }),
  )

  const desktopInstallers = desktopAssets
    .map((asset) => {
      const url = `${releaseBase}/${asset.file}`
      const hash = hashes.get(asset.file)!
      return [
        `  - Architecture: ${asset.arch}`,
        `    InstallerType: ${asset.installerType}`,
        `    Scope: user`,
        `    InstallerUrl: ${url}`,
        `    InstallerSha256: ${hash}`,
        `    UpgradeBehavior: install`,
        `    AppsAndFeaturesEntries:`,
        `      - DisplayName: AX Code`,
        `        Publisher: DEFAI Private Limited`,
      ].join("\n")
    })
    .join("\n")

  writeYaml(
    path.join(desktopDir, `${desktopId}.installer.yaml`),
    [
      `PackageIdentifier: ${desktopId}`,
      `PackageVersion: ${version}`,
      "Platform:",
      "  - Windows.Desktop",
      "MinimumOSVersion: 10.0.17763.0",
      "InstallerType: nullsoft",
      "Scope: user",
      "InstallModes:",
      "  - interactive",
      "  - silent",
      "  - silentWithProgress",
      "UpgradeBehavior: install",
      "Commands:",
      "  - ax-code",
      "ReleaseDate: " + new Date().toISOString().slice(0, 10),
      "Installers:",
      desktopInstallers,
      "ManifestType: installer",
      "ManifestVersion: 1.6.0",
    ].join("\n"),
  )

  // ── CLI ────────────────────────────────────────────────────────────────
  const cliId = "DEFAI.AXCode"
  const cliDir = path.join(args.out, "manifests", "d", "DEFAI", "AXCode", version)

  writeYaml(
    path.join(cliDir, `${cliId}.yaml`),
    [
      `PackageIdentifier: ${cliId}`,
      `PackageVersion: ${version}`,
      "DefaultLocale: en-US",
      "ManifestType: version",
      "ManifestVersion: 1.6.0",
    ].join("\n"),
  )

  writeYaml(
    path.join(cliDir, `${cliId}.locale.en-US.yaml`),
    packageLocale({
      packageId: cliId,
      packageVersion: version,
      packageName: "AX Code",
      shortDescription: "Local-first agent runtime CLI for software work",
      description:
        "AX Code is a local-first agent runtime for coding agents, headless automation, and the AX Code Desktop workspace. This package installs the node-bundled CLI for Windows.",
      moniker: "ax-code",
    }),
  )

  const cliInstallers = cliAssets
    .map((asset) => {
      const url = `${releaseBase}/${asset.file}`
      const hash = hashes.get(asset.file)!
      return [
        `  - Architecture: ${asset.arch}`,
        `    InstallerType: zip`,
        `    NestedInstallerType: portable`,
        `    NestedInstallerFiles:`,
        `      - RelativeFilePath: bin\\ax-code.cmd`,
        `        PortableCommandAlias: ax-code`,
        `    InstallerUrl: ${url}`,
        `    InstallerSha256: ${hash}`,
        `    ArchiveBinariesDependOnPath: true`,
      ].join("\n")
    })
    .join("\n")

  writeYaml(
    path.join(cliDir, `${cliId}.installer.yaml`),
    [
      `PackageIdentifier: ${cliId}`,
      `PackageVersion: ${version}`,
      "Platform:",
      "  - Windows.Desktop",
      "MinimumOSVersion: 10.0.17763.0",
      "InstallerType: zip",
      "Commands:",
      "  - ax-code",
      "ReleaseDate: " + new Date().toISOString().slice(0, 10),
      "Installers:",
      cliInstallers,
      "ManifestType: installer",
      "ManifestVersion: 1.6.0",
    ].join("\n"),
  )

  console.log("")
  console.log("Wrote:")
  console.log(`  ${desktopDir}`)
  console.log(`  ${cliDir}`)
  console.log("")
  console.log("Next: winget validate --manifest <dir>  then open a PR to microsoft/winget-pkgs")
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
