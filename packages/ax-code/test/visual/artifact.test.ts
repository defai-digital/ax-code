import { describe, expect, test, afterEach } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { VisualArtifactStore } from "../../src/visual/artifact"

describe("visual.artifact", () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
    tmpDirs.length = 0
  })

  function mkTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-visual-test-"))
    tmpDirs.push(dir)
    return dir
  }

  test("baseDir returns correct path", () => {
    const dir = VisualArtifactStore.baseDir("/project")
    expect(dir).toBe(path.join("/project", ".ax-code", "visual-runs"))
  })

  test("runDir returns correct path", () => {
    const dir = VisualArtifactStore.runDir("/project", "run-123")
    expect(dir).toBe(path.join("/project", ".ax-code", "visual-runs", "run-123"))
  })

  test("runDir rejects path traversal run ids", () => {
    expect(() => VisualArtifactStore.runDir("/project", "../escape")).toThrow("Invalid visual run id")
    expect(() => VisualArtifactStore.runDir("/project", "/tmp/escape")).toThrow("Invalid visual run id")
    expect(() => VisualArtifactStore.runDir("/project", "")).toThrow("Invalid visual run id")
  })

  test("ensureRunDir creates directory", async () => {
    const projectDir = mkTmpDir()
    const dir = await VisualArtifactStore.ensureRunDir(projectDir, "run-abc")
    expect(fs.existsSync(dir)).toBe(true)
    expect(dir).toBe(path.join(projectDir, ".ax-code", "visual-runs", "run-abc"))
  })

  test("writeScreenshot writes PNG file and returns artifact", async () => {
    const projectDir = mkTmpDir()
    const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header
    const artifact = await VisualArtifactStore.writeScreenshot(projectDir, "run-1", data, "viewport-desktop", {
      format: "png",
      width: 1440,
      height: 900,
    })

    expect(artifact.kind).toBe("screenshot")
    expect(artifact.mime).toBe("image/png")
    expect(artifact.width).toBe(1440)
    expect(artifact.height).toBe(900)
    expect(artifact.sha256).toBeDefined()
    expect(artifact.label).toBe("viewport-desktop")
    expect(fs.existsSync(artifact.path!)).toBe(true)
  })

  test("writeScreenshot writes JPEG file", async () => {
    const projectDir = mkTmpDir()
    const data = Buffer.from([255, 216, 255, 224]) // JPEG header
    const artifact = await VisualArtifactStore.writeScreenshot(projectDir, "run-1", data, "viewport-mobile", {
      format: "jpeg",
      width: 390,
      height: 844,
    })

    expect(artifact.mime).toBe("image/jpeg")
    expect(artifact.path).toContain(".jpg")
  })

  test("writeText writes JSON artifact", async () => {
    const projectDir = mkTmpDir()
    const content = JSON.stringify([{ type: "error", text: "Uncaught TypeError" }])
    const artifact = await VisualArtifactStore.writeText(projectDir, "run-1", "console", content, "console-errors")

    expect(artifact.kind).toBe("console")
    expect(artifact.mime).toBe("text/plain")
    expect(artifact.path).toContain(".json")
    expect(artifact.sha256).toBeDefined()
    expect(artifact.label).toBe("console-errors")

    const written = await fs.promises.readFile(artifact.path!, "utf-8")
    expect(written).toBe(content)
  })

  test("writeText writes DOM artifact as HTML", async () => {
    const projectDir = mkTmpDir()
    const content = "<html><body><h1>Hello</h1></body></html>"
    const artifact = await VisualArtifactStore.writeText(projectDir, "run-1", "dom", content, "dom-snapshot")

    expect(artifact.kind).toBe("dom")
    expect(artifact.path).toContain(".html")
  })

  test("writeRunSummary writes visual-run.json", async () => {
    const projectDir = mkTmpDir()
    const run = {
      id: "run-1",
      sessionID: "ses_test",
      projectID: "proj_test",
      target: { type: "url" as const, url: "http://localhost:3000", profile: "isolated" as const },
      mode: "browser" as const,
      status: "passed" as const,
      createdAt: "2026-07-05T00:00:00Z",
      updatedAt: "2026-07-05T00:00:00Z",
      artifacts: [],
      findings: [],
    }

    await VisualArtifactStore.writeRunSummary(projectDir, run)

    const summaryPath = path.join(projectDir, ".ax-code", "visual-runs", "run-1", "visual-run.json")
    expect(fs.existsSync(summaryPath)).toBe(true)

    const written = JSON.parse(await fs.promises.readFile(summaryPath, "utf-8"))
    expect(written.id).toBe("run-1")
    expect(written.status).toBe("passed")
  })

  test("prune removes old runs beyond retention limit", async () => {
    const projectDir = mkTmpDir()

    // Create 5 run directories
    for (let i = 0; i < 5; i++) {
      await VisualArtifactStore.ensureRunDir(projectDir, `run-${i}`)
    }

    // Prune to keep only 3
    const pruned = await VisualArtifactStore.prune(projectDir, { maxRuns: 3, maxDays: 365 })
    expect(pruned).toBe(2)

    // Verify only 3 remain
    const base = VisualArtifactStore.baseDir(projectDir)
    const remaining = await fs.promises.readdir(base)
    expect(remaining.length).toBe(3)
  })

  test("prune handles non-existent directory gracefully", async () => {
    const projectDir = mkTmpDir()
    const pruned = await VisualArtifactStore.prune(projectDir)
    expect(pruned).toBe(0)
  })
})
