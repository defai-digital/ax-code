import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import { QualityShadow } from "../../src/quality/shadow-runtime"
import { tmpdir } from "../fixture/fixture"

describe("QualityShadow JSON loading", () => {
  test("decodes already-parsed typed shadow JSON values", () => {
    const decoded = QualityShadow.decodeShadowJsonFileValue(
      {
        schemaVersion: 1,
        kind: "ax-code-quality-prediction-file",
        source: "candidate-test",
        generatedAt: "2026-04-20T00:00:00.000Z",
        predictions: [],
      },
      ProbabilisticRollout.PredictionFile,
    )

    expect(decoded.source).toBe("candidate-test")
    expect(decoded.predictions).toEqual([])
    expect(() =>
      QualityShadow.decodeShadowJsonFileValue({ source: "missing shape" }, ProbabilisticRollout.PredictionFile),
    ).toThrow()
  })

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

  test("reports malformed shadow JSON text as a syntax error", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "predictions.json")
    await fs.writeFile(file, "{not json", "utf8")

    const stat = await fs.stat(file)
    await expect(QualityShadow.loadShadowJsonFile(file, ProbabilisticRollout.PredictionFile, stat)).rejects.toThrow(
      SyntaxError,
    )
  })
})
