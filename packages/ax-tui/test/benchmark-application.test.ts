import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

test("application benchmark paints all workloads with real parsing and retains auditable samples", () => {
  const directory = mkdtempSync(join(tmpdir(), "ax-tui-benchmark-report-"))
  try {
    const file = join(directory, "application.json")
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../script/benchmark-application.ts", import.meta.url)),
        `--output=${file}`,
        "--samples=1",
        "--iterations=2",
        "--warmup=1",
        "--profile",
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    )
    expect(child.error, child.stderr).toBeUndefined()
    expect(child.status, child.stdout + child.stderr).toBe(0)
    const report = JSON.parse(readFileSync(file, "utf8"))
    expect(report.kind).toBe("ax-tui-application-workloads")
    expect(report.summaries.map((row: { workload: string }) => row.workload)).toEqual([
      "stream-markdown",
      "scroll-history",
      "resize-text",
      "large-code",
    ])
    for (const workload of report.runs[0].results) {
      expect(workload.samples.length).toBe(2)
      for (const sample of workload.samples) {
        expect(sample.frames).toBeGreaterThan(0)
        expect(sample.outputBytes).toBeGreaterThan(0)
        expect(sample.elapsedMs).toBeGreaterThanOrEqual(sample.mutationMs)
        if (["stream-markdown", "large-code"].includes(workload.workload))
          expect(sample.highlightRequests).toBeGreaterThan(0)
      }
    }
    expect(report.nativeManifestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(report.harnessSha256["script/benchmark-application.ts"]).toMatch(/^[a-f0-9]{64}$/)
    const profiles = readdirSync(report.profiles[0]).filter((file) => file.endsWith(".cpuprofile"))
    expect(profiles.length).toBeGreaterThan(0)
    for (const profile of profiles)
      expect(JSON.parse(readFileSync(join(report.profiles[0], profile), "utf8")).nodes.length).toBeGreaterThan(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 65_000)
