import { describe, expect, test, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { captureSnapshot, pruneSnapshots } from "../../src/visual/snapshot"
import { VisualArtifactStore } from "../../src/visual/artifact"

describe("visual.snapshot", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "visual-snapshot-test-"))
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  describe("captureSnapshot (file source)", () => {
    test("captures a PNG file as a snapshot", async () => {
      // Create a minimal PNG file (1x1 transparent pixel)
      const pngData = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      )
      const imagePath = path.join(tmpDir, "test-image.png")
      await fs.promises.writeFile(imagePath, pngData)

      const result = await captureSnapshot(tmpDir, "session-1", {
        type: "file",
        filePath: imagePath,
      })

      expect(result.run.id).toMatch(/^snap_/)
      expect(result.run.mode).toBe("snapshot")
      expect(result.run.target).toEqual({ type: "snapshot", source: "upload" })
      expect(result.run.sessionID).toBe("session-1")
      expect(result.run.artifacts).toHaveLength(1)
      expect(result.run.artifacts[0].kind).toBe("screenshot")
      expect(result.run.artifacts[0].mime).toBe("image/png")
      expect(result.screenshotData).toEqual(pngData)
    })

    test("captures a JPEG file as a snapshot", async () => {
      // Create a minimal JPEG file
      const jpegData = Buffer.from("/9j/4AAQSkZJRg==", "base64")
      const imagePath = path.join(tmpDir, "test-image.jpg")
      await fs.promises.writeFile(imagePath, jpegData)

      const result = await captureSnapshot(tmpDir, "session-2", {
        type: "file",
        filePath: imagePath,
      })

      expect(result.run.artifacts[0].mime).toBe("image/jpeg")
      expect(result.screenshot.mime).toBe("image/jpeg")
    })

    test("stores the run summary JSON", async () => {
      const pngData = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      )
      const imagePath = path.join(tmpDir, "test-image.png")
      await fs.promises.writeFile(imagePath, pngData)

      const result = await captureSnapshot(tmpDir, "session-3", {
        type: "file",
        filePath: imagePath,
      })

      // Verify the run summary was written
      const summaryPath = path.join(
        VisualArtifactStore.runDir(tmpDir, result.run.id),
        "visual-run.json",
      )
      const summaryContent = await fs.promises.readFile(summaryPath, "utf-8")
      const summary = JSON.parse(summaryContent)
      expect(summary.id).toBe(result.run.id)
      expect(summary.mode).toBe("snapshot")
    })

    test("throws for non-existent file", async () => {
      await expect(
        captureSnapshot(tmpDir, "session-4", {
          type: "file",
          filePath: path.join(tmpDir, "nonexistent.png"),
        }),
      ).rejects.toThrow()
    })
  })

  describe("pruneSnapshots", () => {
    test("prunes runs beyond the limit", async () => {
      // Create several snapshot runs
      for (let i = 0; i < 5; i++) {
        const pngData = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        )
        const imagePath = path.join(tmpDir, `image-${i}.png`)
        await fs.promises.writeFile(imagePath, pngData)
        await captureSnapshot(tmpDir, `session-${i}`, {
          type: "file",
          filePath: imagePath,
        })
      }

      // Prune to max 3 runs
      const pruned = await pruneSnapshots(tmpDir, { maxRuns: 3 })
      expect(pruned).toBe(2)

      // Verify only 3 run directories remain
      const baseDir = VisualArtifactStore.baseDir(tmpDir)
      const remaining = await fs.promises.readdir(baseDir)
      expect(remaining.length).toBe(3)
    })

    test("returns 0 when no runs exist", async () => {
      const pruned = await pruneSnapshots(tmpDir)
      expect(pruned).toBe(0)
    })
  })

  // -- URL source tests --

  test("captureSnapshot from URL uses BrowserRuntime", async () => {
    const closePage = vi.fn(async () => {})
    const open = vi.fn(async () => ({
      pageID: "page_1",
      url: "http://localhost:3000",
      title: "Test App",
      viewport: { width: 1440, height: 900 },
    }))
    const screenshot = vi.fn(async () => ({
      pageID: "page_1",
      data: Buffer.from("url-png-data"),
      format: "png" as const,
      width: 1440,
      height: 900,
    }))

    vi.doMock("@/tool/browser/runtime", () => ({
      BrowserRuntime: {
        get: () => ({ open, screenshot, closePage }),
      },
    }))

    // Re-import to pick up the mock
    const { captureSnapshot } = await import("../../src/visual/snapshot")

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-url-"))
    try {
      const result = await captureSnapshot(tmpDir, "ses_test", {
        type: "url",
        url: "http://localhost:3000",
      })

      expect(result.run.target.type).toBe("snapshot")
      expect(open).toHaveBeenCalledWith("http://localhost:3000", { width: 1440, height: 900 })
      expect(screenshot).toHaveBeenCalled()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
