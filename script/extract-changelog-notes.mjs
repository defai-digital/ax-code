#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const DEFAULT_CHANGELOG = "desktop/CHANGELOG.md"
export const CLI_CHANGELOG_FLOOR = "6.7.4"
const REPO_RELEASES = "https://github.com/defai-digital/ax-code/releases/tag"
const REPO_COMPARE = "https://github.com/defai-digital/ax-code/compare"

export function extractChangelogSection(changelog, version) {
  if (typeof changelog !== "string") throw new Error("changelog must be a string")
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new Error(`invalid version: ${version ?? ""}`)
  }

  const section = changelog.split(/^## /m).find((part) => part.startsWith(`[${version}]`))
  if (!section) throw new Error(`changelog is missing [${version}]`)

  const notes = `## ${section}`.trim()
  const body = notes
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(/^## .*/ms, "")
    .trim()
  if (!body) throw new Error(`changelog section [${version}] is empty`)
  return `${notes}\n`
}

export function tryExtractChangelogSection(changelog, version) {
  try {
    return extractChangelogSection(changelog, version)
  } catch {
    return undefined
  }
}

export function previousChangelogVersion(changelog, version) {
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]/gm)].map((match) => match[1])
  const index = versions.indexOf(version)
  if (index === -1) return undefined
  return versions[index + 1]
}

export function parseReleaseTag(tag) {
  if (typeof tag !== "string") return undefined
  if (tag.startsWith("desktop-v") && VERSION_PATTERN.test(tag.slice("desktop-v".length))) {
    return { channel: "desktop", version: tag.slice("desktop-v".length) }
  }
  if (tag.startsWith("v") && VERSION_PATTERN.test(tag.slice(1))) {
    return { channel: "cli", version: tag.slice(1) }
  }
  return undefined
}

export function releaseTitle(channel, version) {
  return channel === "desktop" ? `AX Code Desktop v${version}` : `AX Code CLI v${version}`
}

export function compareVersion(left, right) {
  const parts = (value) =>
    value.split(".").map((part) => {
      const numeric = Number.parseInt(part, 10)
      return Number.isFinite(numeric) ? numeric : 0
    })
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

export function changelogAppliesToCli(version) {
  return compareVersion(version, CLI_CHANGELOG_FLOOR) >= 0
}

export function classifyReleaseBody(body) {
  const text = (body ?? "").trim()
  if (!text) return "empty"
  if (text.startsWith("**Full Changelog**")) return "full-changelog-only"
  if (text.startsWith("## What's Changed")) return "github-auto-prs"
  if (/^## \[\d+\.\d+/.test(text)) return "changelog-section"
  if (text.split("\n").length === 1 && text.length < 80) return "one-liner"
  if (
    /^# (AX Code( CLI| Desktop)?|ax-code)\b/i.test(text) ||
    text.includes("## Highlights") ||
    text.includes("## Overview")
  ) {
    return "custom-prose"
  }
  return "other"
}

export function shouldReplaceWithChangelog(body, channel, version) {
  if (channel === "cli" && !changelogAppliesToCli(version)) return false
  const kind = classifyReleaseBody(body)
  return kind === "empty" || kind === "full-changelog-only" || kind === "github-auto-prs" || kind === "changelog-section" || kind === "one-liner"
}

function productBlurb(channel, version, siblingTag) {
  const product =
    channel === "desktop"
      ? "Desktop app installers for macOS, Windows, and Linux."
      : "Terminal CLI and TUI archives."
  if (!siblingTag) return product
  const label = channel === "desktop" ? "CLI archives" : "Desktop installers"
  return `${product} ${label} are on [${siblingTag}](${REPO_RELEASES}/${siblingTag}).`
}

function stripExistingTitle(body, version) {
  return body
    .replace(/^# (AX Code( CLI| Desktop)?|ax-code)[^\n]*\n+/i, "")
    .replace(new RegExp(`^## v?${version.replaceAll(".", "\\.")}[^\\n]*\\n+`), "")
    .trim()
}

export function formatReleaseNotes({ channel, version, section, siblingTag, previousTag }) {
  const title = releaseTitle(channel, version)
  const compareTag = channel === "desktop" ? `desktop-v${version}` : `v${version}`
  const compare = previousTag ? `\n\n---\n\n**Full changelog**: ${REPO_COMPARE}/${previousTag}...${compareTag}` : ""
  return `# ${title}\n\n${productBlurb(channel, version, siblingTag)}\n\n${section.trim()}${compare}\n`
}

export function wrapExistingNotes({ channel, version, body, siblingTag }) {
  const title = releaseTitle(channel, version)
  const rest = stripExistingTitle((body ?? "").trim(), version)
  const header = `# ${title}\n\n${productBlurb(channel, version, siblingTag)}`
  if (!rest) return `${header}\n`
  if (rest.startsWith(`# ${title}`)) return `${rest}\n`
  return `${header}\n\n${rest}\n`
}

export function inferredPreviousTag(channel, changelog, version) {
  const prior = previousChangelogVersion(changelog, version)
  if (!prior) return undefined
  return channel === "desktop" ? `desktop-v${prior}` : `v${prior}`
}

export function buildReleaseNotes({ channel, version, body, changelog, siblingTag, previousTag }) {
  const section = tryExtractChangelogSection(changelog ?? "", version)
  if (section && shouldReplaceWithChangelog(body, channel, version)) {
    return formatReleaseNotes({
      channel,
      version,
      section,
      siblingTag,
      previousTag: previousTag ?? inferredPreviousTag(channel, changelog, version),
    })
  }
  return wrapExistingNotes({ channel, version, body, siblingTag })
}

function parseCli(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (
      value === "--version" ||
      value === "--out" ||
      value === "--changelog" ||
      value === "--channel" ||
      value === "--sibling" ||
      value === "--previous"
    ) {
      const next = argv[index + 1]
      if (!next) throw new Error(`${value} requires a value`)
      values[value.slice(2)] = next
      index += 1
      continue
    }
    if (value.startsWith("--")) throw new Error(`unknown option: ${value}`)
    throw new Error(`unexpected argument: ${value}`)
  }
  return values
}

function usage() {
  return "Usage: node script/extract-changelog-notes.mjs --version <version> --out <file> [--changelog <file>] [--channel cli|desktop] [--sibling <tag>] [--previous <tag>]"
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseCli(argv)
  if (!options.version || !options.out) throw new Error(usage())
  if (options.channel && options.channel !== "cli" && options.channel !== "desktop") {
    throw new Error("--channel must be cli or desktop")
  }

  const changelogPath = path.resolve(cwd, options.changelog ?? DEFAULT_CHANGELOG)
  const outputPath = path.resolve(cwd, options.out)
  const changelog = await readFile(changelogPath, "utf8")
  const section = extractChangelogSection(changelog, options.version)
  const previous = options.previous ?? (() => {
    const prior = previousChangelogVersion(changelog, options.version)
    if (!prior || !options.channel) return undefined
    return options.channel === "desktop" ? `desktop-v${prior}` : `v${prior}`
  })()
  const notes = options.channel
    ? formatReleaseNotes({
        channel: options.channel,
        version: options.version,
        section,
        siblingTag: options.sibling,
        previousTag: previous,
      })
    : section
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, notes)
  return outputPath
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
