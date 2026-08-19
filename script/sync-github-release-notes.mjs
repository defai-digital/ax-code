#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { readFile } from "node:fs/promises"
import {
  buildReleaseNotes,
  parseReleaseTag,
  releaseTitle,
} from "./extract-changelog-notes.mjs"

const DEFAULT_REPO = "defai-digital/ax-code"
const DEFAULT_CHANGELOG = "desktop/CHANGELOG.md"

function parseCli(argv) {
  const values = { apply: false, repo: DEFAULT_REPO, changelog: DEFAULT_CHANGELOG, limit: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--apply") {
      values.apply = true
      continue
    }
    if (value === "--repo" || value === "--changelog" || value === "--limit" || value === "--only") {
      const next = argv[index + 1]
      if (!next) throw new Error(`${value} requires a value`)
      values[value.slice(2)] = next
      index += 1
      continue
    }
    if (value.startsWith("--")) throw new Error(`unknown option: ${value}`)
    throw new Error(`unexpected argument: ${value}`)
  }
  if (values.limit !== undefined) values.limit = Number(values.limit)
  return values
}

function runGh(args, options = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || "").trim()
    throw new Error(`gh ${args.join(" ")} failed: ${stderr}`)
  }
  return result.stdout
}

function loadReleases(repo) {
  const raw = runGh(["api", `repos/${repo}/releases?per_page=100`, "--paginate"])
  const parsed = JSON.parse(raw.replace(/\]\s*\[/g, ","))
  if (!Array.isArray(parsed)) throw new Error("GitHub releases response was not an array")
  return parsed
}

function siblingTag(parsed, tags) {
  const other = parsed.channel === "desktop" ? `v${parsed.version}` : `desktop-v${parsed.version}`
  return tags.has(other) ? other : undefined
}

export function planReleaseUpdates(releases, changelog) {
  const tags = new Set(releases.map((release) => release.tag_name))
  const plan = []
  for (const release of releases) {
    const parsed = parseReleaseTag(release.tag_name)
    if (!parsed) continue
    const name = releaseTitle(parsed.channel, parsed.version)
    const notes = buildReleaseNotes({
      channel: parsed.channel,
      version: parsed.version,
      body: release.body ?? "",
      changelog,
      siblingTag: siblingTag(parsed, tags),
    })
    const currentName = release.name ?? release.tag_name
    const currentBody = `${release.body ?? ""}`.replace(/\r\n/g, "\n")
    if (currentName === name && currentBody.trim() === notes.trim()) continue
    plan.push({
      tag: release.tag_name,
      draft: release.draft === true,
      name,
      notes,
      previousName: currentName,
    })
  }
  return plan
}

async function applyUpdate(repo, item) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-release-notes-"))
  const notesFile = path.join(dir, `${item.tag.replaceAll("/", "-")}.md`)
  await writeFile(notesFile, item.notes)
  runGh(["release", "edit", item.tag, "--repo", repo, "--title", item.name, "--notes-file", notesFile])
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseCli(argv)
  const changelog = await readFile(path.resolve(cwd, options.changelog), "utf8")
  const releases = loadReleases(options.repo)
  let plan = planReleaseUpdates(releases, changelog)
  if (options.only) plan = plan.filter((item) => item.tag === options.only)
  if (Number.isFinite(options.limit)) plan = plan.slice(0, options.limit)

  console.log(`${plan.length} release${plan.length === 1 ? "" : "s"} to update`)
  for (const item of plan) {
    const draft = item.draft ? " draft" : ""
    console.log(`- ${item.tag}${draft}: ${item.previousName} -> ${item.name}`)
  }

  if (!options.apply) {
    console.log("Dry run. Re-run with --apply to update GitHub release titles and notes.")
    return plan
  }

  let updated = 0
  for (const item of plan) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await applyUpdate(options.repo, item)
        updated += 1
        console.log(`updated ${item.tag}`)
        break
      } catch (error) {
        if (attempt >= 5) throw error
        const delay = attempt * 2000
        console.warn(`retry ${item.tag} in ${delay}ms: ${error instanceof Error ? error.message : error}`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
      }
    }
  }
  console.log(`updated ${updated} releases`)
  return plan
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
