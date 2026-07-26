#!/usr/bin/env node

import { createRequire } from "node:module"
import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const requireFromElectronBuilder = createRequire(require.resolve("electron-builder/package.json"))
const { buildBlockMap } = requireFromElectronBuilder("app-builder-lib/out/targets/blockmap/blockmap")

function yamlValue(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, "$2")
}

export function refreshMacUpdateMetadataText(text, artifact) {
  const lines = text.split(/\r?\n/)
  let inFiles = false
  let targetFile = false
  let foundFile = false
  let foundFileSha = false
  let foundFileSize = false
  let canonicalTarget = false
  let foundCanonicalSha = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    if (line === "files:") {
      inFiles = true
      targetFile = false
      continue
    }

    if (inFiles && /^\S/.test(line)) {
      inFiles = false
      targetFile = false
    }

    const fileUrl = inFiles ? line.match(/^  - url:\s*(.+)$/) : null
    if (fileUrl) {
      targetFile = yamlValue(fileUrl[1]) === artifact.name
      if (targetFile) foundFile = true
      continue
    }

    if (targetFile && /^    sha512:/.test(line)) {
      lines[index] = `    sha512: ${artifact.sha512}`
      foundFileSha = true
      continue
    }

    if (targetFile && /^    size:/.test(line)) {
      lines[index] = `    size: ${artifact.size}`
      foundFileSize = true
      continue
    }

    const canonicalPath = !inFiles ? line.match(/^path:\s*(.+)$/) : null
    if (canonicalPath) {
      canonicalTarget = yamlValue(canonicalPath[1]) === artifact.name
      continue
    }

    if (canonicalTarget && /^sha512:/.test(line)) {
      lines[index] = `sha512: ${artifact.sha512}`
      foundCanonicalSha = true
      canonicalTarget = false
    }
  }

  if (!foundFile) throw new Error(`latest-mac.yml does not list ${artifact.name}`)
  if (!foundFileSha || !foundFileSize) {
    throw new Error(`latest-mac.yml entry for ${artifact.name} is missing sha512 or size`)
  }
  if (canonicalTarget && !foundCanonicalSha) {
    throw new Error(`latest-mac.yml canonical entry for ${artifact.name} is missing sha512`)
  }

  return lines.join("\n")
}

export async function refreshMacUpdateArtifacts(artifactPath, metadataPath) {
  const resolvedArtifact = path.resolve(artifactPath)
  const resolvedMetadata = path.resolve(metadataPath)
  const blockmapPath = `${resolvedArtifact}.blockmap`
  const updateInfo = await buildBlockMap(resolvedArtifact, "gzip", blockmapPath)
  const artifact = {
    name: path.basename(resolvedArtifact),
    sha512: updateInfo.sha512,
    size: updateInfo.size,
  }
  const metadata = await fs.readFile(resolvedMetadata, "utf8")
  const refreshed = refreshMacUpdateMetadataText(metadata, artifact)
  await fs.writeFile(resolvedMetadata, refreshed)

  const blockmap = await fs.stat(blockmapPath)
  if (!blockmap.isFile() || blockmap.size === 0) {
    throw new Error(`failed to regenerate a non-empty blockmap: ${blockmapPath}`)
  }

  return { artifact, blockmapPath, metadataPath: resolvedMetadata }
}

function usage() {
  return `Usage:
  node refresh-macos-update-metadata.mjs --artifact <dmg> --metadata <latest-mac.yml>

Regenerates the artifact blockmap and updates latest-mac.yml from the final
codesigned, notarized, and stapled DMG bytes.
`
}

async function main() {
  const parsed = parseArgs({
    options: {
      artifact: { type: "string" },
      metadata: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (parsed.values.help) {
    console.log(usage())
    return
  }
  if (!parsed.values.artifact || !parsed.values.metadata) {
    throw new Error("--artifact and --metadata are required")
  }

  const refreshed = await refreshMacUpdateArtifacts(parsed.values.artifact, parsed.values.metadata)
  console.log(
    `Refreshed ${refreshed.artifact.name}: size=${refreshed.artifact.size}, blockmap=${refreshed.blockmapPath}, metadata=${refreshed.metadataPath}`,
  )
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
