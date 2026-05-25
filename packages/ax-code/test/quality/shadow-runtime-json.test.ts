import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityShadow } from "../../src/quality/shadow-runtime"
import { tmpdir } from "../fixture/fixture"

describe("QualityShadow JSON loading", () => {
  test("loads typed shadow JSON files with mtime metadata", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "predictions.json")
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        kind: "ax-code-quality-prediction-file",
        source: "candidate-test",
        generatedAt: "2026-04-20T00:00:00.000Z",
        predictions: [],
      }),
      "utf8",
    )

    const stat = await fs.stat(file)
    const loaded = await QualityShadow.loadShadowJsonFile(file, ProbabilisticRollout.PredictionFile, stat)

    expect(loaded.mtimeMs).toBe(stat.mtimeMs)
    expect(loaded.file.source).toBe("candidate-test")
    expect(loaded.file.predictions).toEqual([])
  })

  test("rejects malformed typed shadow JSON files at the loader boundary", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "predictions.json")
    await fs.writeFile(file, JSON.stringify({ source: "missing shape" }), "utf8")

    const stat = await fs.stat(file)
    await expect(QualityShadow.loadShadowJsonFile(file, ProbabilisticRollout.PredictionFile, stat)).rejects.toThrow()
  })
})
