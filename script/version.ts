#!/usr/bin/env -S npx tsx

import { Script } from "@ax-code/script"
import { execFileSync } from "child_process"
import fs from "fs/promises"

// Run a command inheriting stdio (replaces Bun `$` for side-effecting commands).
function sh(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: "inherit" })
}
// Run a command and capture stdout (replaces Bun `$`.json()/.text()).
function shOut(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { encoding: "utf8" })
}

const output = [`version=${Script.version}`]

if (!Script.preview) {
  sh("ax-code", ["run", "--command", "changelog"])
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = await fs.readFile(file, "utf8").catch(() => "No notable changes")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/ax-code-release-notes.txt`
  await fs.writeFile(notesFile, body)
  sh("gh", [
    "release",
    "create",
    `v${Script.version}`,
    "-d",
    "--title",
    `v${Script.version}`,
    "--notes-file",
    notesFile,
  ])
  const release = JSON.parse(
    shOut("gh", ["release", "view", `v${Script.version}`, "--json", "tagName,databaseId"]),
  ) as { tagName: string; databaseId: number }
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  sh("gh", [
    "release",
    "create",
    `v${Script.version}`,
    "-d",
    "--title",
    `v${Script.version}`,
    "--repo",
    process.env.GH_REPO ?? "",
  ])
  const release = JSON.parse(
    shOut("gh", [
      "release",
      "view",
      `v${Script.version}`,
      "--json",
      "tagName,databaseId",
      "--repo",
      process.env.GH_REPO ?? "",
    ]),
  ) as { tagName: string; databaseId: number }
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await fs.writeFile(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
