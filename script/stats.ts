#!/usr/bin/env -S npx tsx

import fs from "fs/promises"
import { spawnSync } from "child_process"

async function sendToPostHog(event: string, properties: Record<string, any>) {
  const key = process.env["POSTHOG_KEY"]

  if (!key) {
    console.warn("POSTHOG_API_KEY not set, skipping PostHog event")
    return
  }

  const response = await fetch("https://us.i.posthog.com/i/v0/e/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      distinct_id: "download",
      api_key: key,
      event,
      properties: {
        ...properties,
      },
    }),
  }).catch(() => null)

  if (response && !response.ok) {
    console.warn(`PostHog API error: ${response.status}`)
  }
}

interface Asset {
  name: string
  download_count: number
}

interface Release {
  tag_name: string
  name: string
  assets: Asset[]
}

async function fetchReleases(): Promise<Release[]> {
  const releases: Release[] = []
  let page = 1
  const per = 100

  while (true) {
    const url = `https://api.github.com/repos/defai-digital/ax-code/releases?page=${page}&per_page=${per}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    const batch: Release[] = await response.json()
    if (batch.length === 0) break

    releases.push(...batch)
    console.log(`Fetched page ${page} with ${batch.length} releases`)

    if (batch.length < per) break
    page++
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return releases
}

function calculate(releases: Release[]) {
  let total = 0
  const stats = []

  for (const release of releases) {
    let downloads = 0
    const assets = []

    for (const asset of release.assets) {
      downloads += asset.download_count
      assets.push({
        name: asset.name,
        downloads: asset.download_count,
      })
    }

    total += downloads
    stats.push({
      tag: release.tag_name,
      name: release.name,
      downloads,
      assets,
    })
  }

  return { total, stats }
}

async function save(githubTotal: number) {
  const file = "STATS.md"
  const date = new Date().toISOString().split("T")[0]

  let previousGithub = 0
  let content = ""

  try {
    content = await fs.readFile(file, "utf8")
    const lines = content.trim().split("\n")

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.startsWith("|") && !line.includes("Date") && !line.includes("---")) {
        const match = line.match(/\|\s*[\d-]+\s*\|\s*([\d,]+)\s*(?:\([^)]*\))?\s*\|/)
        if (match) {
          previousGithub = parseInt(match[1].replace(/,/g, ""))
          break
        }
      }
    }
  } catch {
    content = "# Download Stats\n\n| Date | GitHub Downloads |\n|------|------------------|\n"
  }

  const githubChange = githubTotal - previousGithub
  const githubChangeStr =
    githubChange > 0
      ? ` (+${githubChange.toLocaleString()})`
      : githubChange < 0
        ? ` (${githubChange.toLocaleString()})`
        : " (+0)"
  const line = `| ${date} | ${githubTotal.toLocaleString()}${githubChangeStr} |\n`

  if (!content.includes("# Download Stats")) {
    content = "# Download Stats\n\n| Date | GitHub Downloads |\n|------|------------------|\n"
  }

  await fs.writeFile(file, content + line)
  spawnSync("npx", ["prettier", "--write", file], { stdio: "inherit" })

  console.log(`\nAppended stats to ${file}: GitHub ${githubTotal.toLocaleString()}${githubChangeStr}`)
}

console.log("Fetching GitHub releases for defai-digital/ax-code...\n")

const releases = await fetchReleases()
console.log(`\nFetched ${releases.length} releases total\n`)

const { total: githubTotal, stats } = calculate(releases)

await save(githubTotal)

await sendToPostHog("download", {
  count: githubTotal,
  source: "github",
})

console.log("=".repeat(60))
console.log(`GitHub downloads: ${githubTotal.toLocaleString()}`)
console.log("=".repeat(60))

console.log("-".repeat(60))
console.log(`GitHub Total: ${githubTotal.toLocaleString()} downloads across ${releases.length} releases`)

console.log("-".repeat(60))
console.log("Top releases:")
stats
  .sort((a, b) => b.downloads - a.downloads)
  .slice(0, 10)
  .forEach((release, i) => {
    console.log(`${i + 1}. ${release.tag}: ${release.downloads.toLocaleString()} downloads`)
    release.assets
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 3)
      .forEach((asset) => {
        console.log(`   - ${asset.name}: ${asset.downloads.toLocaleString()}`)
      })
  })
