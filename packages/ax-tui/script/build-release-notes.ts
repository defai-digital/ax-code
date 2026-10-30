import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGE_URL = "https://github.com/orgs/defai-digital/packages/npm/package/ax-tui"
const MAINTENANCE_URL = "https://github.com/defai-digital/ax-tui/blob/main/MAINTENANCE.md"

/**
 * Extract the CHANGELOG section for one released version.
 *
 * The section runs from the `## [<version>]` heading (inclusive of the date
 * line, exclusive of nothing else) through the line before the next `## [`
 * heading or the end of the file. Returns null when the version has no
 * section.
 */
export function extractVersionSection(changelog: string, version: string): string | null {
  const marker = `## [${version}]`
  const start = changelog.indexOf(marker)
  if (start === -1) return null
  const headingEnd = changelog.indexOf("\n", start)
  const afterHeading = headingEnd === -1 ? changelog.length : headingEnd + 1
  const next = changelog.indexOf("\n## [", afterHeading)
  const end = next === -1 ? changelog.length : next
  return changelog.slice(afterHeading, end).trim()
}

/**
 * Compose the GitHub release body for one ax-tui version.
 *
 * The GitHub release preserves immutable native assets alongside the public
 * GitHub Packages distribution, which also bundles the platform libraries.
 */
export function buildBody(version: string, section: string): string {
  return [
    `# ax-tui v${version}`,
    "",
    `Public GitHub Packages release [\`@defai-digital/ax-tui@${version}\`](${PACKAGE_URL}).`,
    "",
    "The package includes JavaScript, type declarations, tree-sitter assets, and verified native libraries/licenses.",
    "Normal installations load the bundled native library without downloading release assets. See",
    `[MAINTENANCE.md](${MAINTENANCE_URL}) for registry authentication and the release process.`,
    "",
    "## What's changed",
    "",
    section,
    "",
    "## Install",
    "",
    "```sh",
    `pnpm add @defai-digital/ax-tui@${version} solid-js@1.9.17 web-tree-sitter@0.25.10`,
    "```",
    "",
    "The platform libraries are listed as release assets above; each platform also ships a matching `-LICENSE` file.",
    "",
  ].join("\n")
}

/** Load CHANGELOG.md from the repo root. */
export async function loadChangelog(root: string = repoRoot): Promise<string> {
  return readFile(path.join(root, "CHANGELOG.md"), "utf8")
}

/**
 * Build the complete release body for a version from the given changelog text.
 * Throws when the version has no CHANGELOG section.
 */
export function buildReleaseNotes(changelog: string, version: string): string {
  const section = extractVersionSection(changelog, version)
  if (section === null) {
    throw new Error(`No CHANGELOG section found for version ${version}; add one before releasing.`)
  }
  return buildBody(version, section)
}

async function main(): Promise<void> {
  const [version, output] = process.argv.slice(2)
  if (!version) {
    console.error("usage: tsx script/build-release-notes.ts <version> [output-file]")
    process.exit(1)
  }
  const changelog = await loadChangelog()
  const body = buildReleaseNotes(changelog, version)
  if (output) {
    await writeFile(path.resolve(repoRoot, output), body)
  } else {
    process.stdout.write(body)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
