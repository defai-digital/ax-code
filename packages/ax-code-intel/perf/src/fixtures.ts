// Fixture resolution for the perf harness.
//
// Synthetic fixtures ship in-repo under perf/fixtures/synthetic/ and are
// pinned by manifest.json (sha256 per file + precomputed LSP query points).
// The harness never runs scenarios against the source tree — servers can
// create lockfiles/build dirs (Cargo.lock, target/) — so each run
// materializes a copy into a temp dir first.
//
// External fixtures (the recorded-baseline corpus) are git repos pinned by
// SHA in external.json. A null sha means "not pinned yet" and fails fast —
// silently benchmarking a moving target is worse than not benchmarking.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import z from "zod"
import type { MetricLanguage } from "./metrics"

const execFileAsync = promisify(execFile)

const PERF_ROOT = fileURLToPath(new URL("..", import.meta.url))

export const FixtureQuery = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
  symbol: z.string(),
})
export type FixtureQuery = z.infer<typeof FixtureQuery>

export const FixtureDescriptor = z.object({
  id: z.string(),
  language: z.enum(["ts", "py", "rust"]),
  serverId: z.string(),
  serverBinary: z.string(),
  diagnosticFile: z.string(),
  files: z.record(z.string(), z.string()),
  queries: z.object({
    hover: z.array(FixtureQuery),
    definition: z.array(FixtureQuery),
    references: z.array(FixtureQuery),
  }),
})
export type FixtureDescriptor = z.infer<typeof FixtureDescriptor>

const SyntheticManifest = z.object({
  version: z.literal(1),
  fixtures: z.array(FixtureDescriptor),
})

const ExternalManifest = z.object({
  fixtures: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      sha: z.string().nullable(),
      language: z.enum(["ts", "py", "rust"]),
      serverId: z.string(),
      serverBinary: z.string(),
    }),
  ),
})
export type ExternalFixture = z.infer<typeof ExternalManifest>["fixtures"][number]

export function syntheticFixturesDir(): string {
  return path.join(PERF_ROOT, "fixtures", "synthetic")
}

export function externalManifestPath(): string {
  return path.join(PERF_ROOT, "fixtures", "external.json")
}

export function baselineDir(): string {
  return path.join(PERF_ROOT, "baseline")
}

export async function loadSyntheticFixtures(): Promise<FixtureDescriptor[]> {
  const raw = await readFile(path.join(syntheticFixturesDir(), "manifest.json"), "utf8")
  const manifest = SyntheticManifest.parse(JSON.parse(raw))
  for (const fixture of manifest.fixtures) {
    await verifyFixtureHashes(fixture)
  }
  return manifest.fixtures
}

// Determinism guard: every manifest entry must exist on disk with a matching
// sha256. A mismatch means someone edited a fixture without regenerating the
// manifest — fail loudly instead of benchmarking an unrecorded tree.
export async function verifyFixtureHashes(fixture: FixtureDescriptor): Promise<void> {
  const dir = path.join(syntheticFixturesDir(), fixture.id)
  const mismatches: string[] = []
  for (const [rel, expected] of Object.entries(fixture.files)) {
    let content: Buffer
    try {
      content = await readFile(path.join(dir, rel))
    } catch {
      mismatches.push(`${rel} (missing)`)
      continue
    }
    const actual = createHash("sha256").update(content).digest("hex")
    if (actual !== expected) mismatches.push(`${rel} (hash drift)`)
  }
  if (mismatches.length > 0) {
    throw new Error(
      `synthetic fixture "${fixture.id}" failed its determinism check:\n  ${mismatches.join("\n  ")}\n` +
        `If the edit was intentional, refresh hashes with: tsx perf/src/fixtures.ts --write-manifest`,
    )
  }
}

// Copy a synthetic fixture into a fresh temp dir and return the workdir.
// AX_CODE_PERF_TMP overrides the temp root so concurrent runs stay isolated
// (mirrors the per-PID XDG isolation used by the core test fixtures).
export async function materializeFixture(
  fixture: FixtureDescriptor,
): Promise<{ workDir: string; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(path.join(process.env.AX_CODE_PERF_TMP ?? os.tmpdir(), `ax-code-perf-${fixture.id}-`))
  const workDir = path.join(base, fixture.id)
  await cp(path.join(syntheticFixturesDir(), fixture.id), workDir, { recursive: true })
  return {
    workDir,
    cleanup: () => rm(base, { recursive: true, force: true }),
  }
}

export async function loadExternalFixtures(): Promise<ExternalFixture[]> {
  const raw = await readFile(externalManifestPath(), "utf8")
  return ExternalManifest.parse(JSON.parse(raw)).fixtures
}

// Clone an external fixture at its pinned SHA into targetDir/<id>. Uses a
// shallow fetch of the exact SHA; a force-pushed or deleted commit fails the
// fetch and surfaces as an explicit error.
export async function cloneExternalFixture(fixture: ExternalFixture, targetDir: string): Promise<string> {
  if (!fixture.sha) {
    throw new Error(
      `external fixture "${fixture.id}" has no pinned SHA in ${externalManifestPath()}. ` +
        `Pin a commit before recording a baseline against it.`,
    )
  }
  const dir = path.join(targetDir, fixture.id)
  const git = (args: string[], cwd?: string) => execFileAsync("git", args, { cwd })
  await git(["init", dir])
  await git(["remote", "add", "origin", fixture.url], dir)
  await git(["fetch", "--depth", "1", "origin", fixture.sha], dir)
  await git(["checkout", "FETCH_HEAD"], dir)
  return dir
}

// CLI: refresh manifest hashes after an intentional fixture edit. Query
// points and every other field are preserved; only `files` is rewritten.
async function main() {
  if (process.argv[2] !== "--write-manifest") {
    console.error("usage: tsx perf/src/fixtures.ts --write-manifest")
    process.exit(1)
  }
  const manifestPath = path.join(syntheticFixturesDir(), "manifest.json")
  const manifest = SyntheticManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")))
  for (const fixture of manifest.fixtures) {
    const files: Record<string, string> = {}
    for (const rel of Object.keys(fixture.files)) {
      const content = await readFile(path.join(syntheticFixturesDir(), fixture.id, rel))
      files[rel] = createHash("sha256").update(content).digest("hex")
    }
    fixture.files = files
  }
  const { writeFile } = await import("node:fs/promises")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  console.log(`refreshed ${manifest.fixtures.length} fixture manifests`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
