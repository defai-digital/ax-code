#!/usr/bin/env node
/**
 * Merges the per-arch Windows latest.yml files produced by the separate x64 and
 * arm64 build jobs into one release-level latest.yml consumed by electron-updater.
 *
 * Each Windows build job runs on its own runner and emits its own latest.yml
 * (always named "latest.yml", regardless of arch). Uploading both to the same
 * release would clobber one. electron-updater on Windows reads a single
 * latest.yml and selects the entry from `files:` that matches the running CPU
 * arch, so the correct artifact is to publish ONE latest.yml whose `files:`
 * array lists both the x64 and arm64 installers.
 *
 * Environment variables (set by CI):
 *   LATEST_YML_DIR      – directory containing downloaded per-arch artifacts
 *   AX_CODE_DESKTOP_VERSION – release version (e.g. "0.9.2")
 *
 * Output: $RUNNER_TEMP/latest.yml
 *
 * The pure helpers are exported for unit testing; the file IO only runs when the
 * script is invoked directly (e.g. `node finalize-windows-latest-yml.mjs`).
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { pathToFileURL } from 'url'

// download-artifact@v4 without merge-multiple creates a subdir named after the
// artifact: latest-yml-<target>/latest.yml
export const PER_ARCH_ARTIFACT_DIRS = [
  'latest-yml-x86_64-pc-windows-msvc',
  'latest-yml-aarch64-pc-windows-msvc',
]

// electron-updater YAML is simple enough to parse without a YAML library:
// each file entry is an indented object inside a "files:" block.
export function parseLatestYml(text) {
  const lines = text.split('\n')
  const result = { files: [] }
  let currentFile = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('version:')) {
      result.version = line.split(':')[1].trim().replace(/['"]/g, '')
    } else if (line.startsWith('releaseDate:')) {
      result.releaseDate = line.split(':').slice(1).join(':').trim().replace(/['"]/g, '')
    } else if (line.startsWith('files:')) {
      // start of files array
    } else if (/^  - url:/.test(line)) {
      if (currentFile) result.files.push(currentFile)
      currentFile = { url: line.replace(/^  - url:/, '').trim() }
    } else if (/^    sha512:/.test(line) && currentFile) {
      currentFile.sha512 = line.replace(/^    sha512:/, '').trim()
    } else if (/^    size:/.test(line) && currentFile) {
      currentFile.size = Number(line.replace(/^    size:/, '').trim())
    } else if (/^    blockMapSize:/.test(line) && currentFile) {
      currentFile.blockMapSize = Number(line.replace(/^    blockMapSize:/, '').trim())
    } else if (line.startsWith('path:')) {
      result.path = line.split(':')[1].trim().replace(/['"]/g, '')
    } else if (line.startsWith('sha512:')) {
      result.sha512 = line.split(':').slice(1).join(':').trim()
    }
  }
  if (currentFile) result.files.push(currentFile)
  return result
}

export function emitYml(obj) {
  const lines = [`version: ${obj.version}`, 'files:']
  for (const f of obj.files) {
    lines.push(`  - url: ${f.url}`)
    lines.push(`    sha512: ${f.sha512}`)
    lines.push(`    size: ${f.size}`)
    if (f.blockMapSize) lines.push(`    blockMapSize: ${f.blockMapSize}`)
  }
  // electron-updater uses the first entry as the canonical path/sha512.
  const canonical = obj.files[0]
  lines.push(`path: ${canonical.url}`)
  lines.push(`sha512: ${canonical.sha512}`)
  lines.push(`releaseDate: '${new Date().toISOString()}'`)
  return lines.join('\n') + '\n'
}

/**
 * Merge per-arch latest.yml texts into a single manifest object. File entries
 * are deduplicated by url so a repeated artifact doesn't appear twice.
 */
export function mergeLatestYmls(texts, version, releaseDate = new Date().toISOString()) {
  const seenUrls = new Set()
  const mergedFiles = []
  for (const text of texts) {
    const parsed = parseLatestYml(text)
    for (const f of parsed.files) {
      if (!seenUrls.has(f.url)) {
        seenUrls.add(f.url)
        mergedFiles.push(f)
      }
    }
  }
  return { version, files: mergedFiles, releaseDate }
}

function main() {
  const latestYmlDir = process.env.LATEST_YML_DIR
  const version = process.env.AX_CODE_DESKTOP_VERSION

  if (!latestYmlDir) throw new Error('LATEST_YML_DIR is not set')
  if (!version) throw new Error('AX_CODE_DESKTOP_VERSION is not set')

  const texts = []
  let found = 0
  for (const dir of PER_ARCH_ARTIFACT_DIRS) {
    const file = path.join(latestYmlDir, dir, 'latest.yml')
    if (!fs.existsSync(file)) {
      console.warn(`[finalize-windows-latest-yml] missing (skipped): ${file}`)
      continue
    }
    found += 1
    texts.push(fs.readFileSync(file, 'utf8'))
  }

  if (found === 0) throw new Error(`No Windows latest.yml found under ${latestYmlDir}`)

  const merged = mergeLatestYmls(texts, version)
  if (merged.files.length === 0) throw new Error('Windows latest.yml files contained no file entries')

  const outPath = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'latest.yml')
  fs.writeFileSync(outPath, emitYml(merged))
  console.log(`[finalize-windows-latest-yml] wrote ${outPath} (${merged.files.length} file entries from ${found} arch manifest(s))`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
