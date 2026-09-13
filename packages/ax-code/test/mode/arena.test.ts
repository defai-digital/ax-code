import { describe, expect, test } from "vitest"
import { Arena } from "../../src/mode/arena"

describe("Arena.rankArenaCandidates", () => {
  test("ranks pass above fail regardless of popularity", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "popular-wrong",
          providerID: "a",
          modelID: "1",
          verification: "fail",
          popularity: 99,
          riskScore: 1,
        },
        {
          id: "correct",
          providerID: "b",
          modelID: "2",
          verification: "pass",
          popularity: 0,
          riskScore: 5,
        },
      ],
      "hybrid_score",
    )
    expect(ranked[0]!.id).toBe("correct")
    expect(ranked[1]!.id).toBe("popular-wrong")
  })

  test("prefers lower risk among passers", () => {
    const ranked = Arena.rankArenaCandidates([
      {
        id: "risky",
        providerID: "a",
        modelID: "1",
        verification: "pass",
        riskScore: 15,
      },
      {
        id: "safe",
        providerID: "b",
        modelID: "2",
        verification: "pass",
        riskScore: 2,
      },
    ])
    expect(ranked[0]!.id).toBe("safe")
  })

  test("clamps invalid negative risk instead of awarding extra score", () => {
    const ranked = Arena.rankArenaCandidates([
      {
        id: "negative",
        providerID: "a",
        modelID: "1",
        verification: "pass",
        riskScore: -10,
      },
      {
        id: "zero",
        providerID: "b",
        modelID: "2",
        verification: "pass",
        riskScore: 0,
      },
    ])

    expect(ranked.find((candidate) => candidate.id === "negative")?.score).toBe(120)
    expect(ranked.find((candidate) => candidate.id === "zero")?.score).toBe(120)
    expect(ranked.find((candidate) => candidate.id === "negative")?.reasons).toContain("risk:0")
  })

  test("diversity penalizes duplicate fingerprints among passers", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "c1",
          providerID: "a",
          modelID: "1",
          verification: "pass",
          riskScore: 1,
          patchFingerprint: "same",
        },
        {
          id: "c2",
          providerID: "b",
          modelID: "2",
          verification: "pass",
          riskScore: 2,
          patchFingerprint: "same",
        },
        {
          id: "c3",
          providerID: "c",
          modelID: "3",
          verification: "pass",
          riskScore: 3,
          patchFingerprint: "different",
        },
      ],
      "diversity",
    )
    // After first pick (lowest risk c1), prefer novel fingerprint over duplicate
    expect(ranked[0]!.id).toBe("c1")
    expect(ranked[1]!.id).toBe("c3")
    expect(ranked[2]!.id).toBe("c2")
  })

  test("unknown ranks between pass and fail", () => {
    const ranked = Arena.rankArenaCandidates([
      { id: "f", providerID: "a", modelID: "1", verification: "fail" },
      { id: "u", providerID: "b", modelID: "2", verification: "unknown" },
      { id: "p", providerID: "c", modelID: "3", verification: "pass" },
    ])
    expect(ranked.map((r) => r.id)).toEqual(["p", "u", "f"])
  })

  test("renderRankingMarkdown non-empty", () => {
    const md = Arena.renderRankingMarkdown(
      Arena.rankArenaCandidates([{ id: "x", providerID: "p", modelID: "m", verification: "pass" }]),
    )
    expect(md).toContain("Arena ranking")
    expect(md).toContain("p/m")
  })

  test("judge score replaces the self-assessed risk contribution (ADR-101)", () => {
    const ranked = Arena.rankArenaCandidates([
      { id: "low-self-risk", providerID: "a", modelID: "1", verification: "unknown", riskScore: 1, judgeScore: 8 },
      { id: "high-self-risk", providerID: "b", modelID: "2", verification: "unknown", riskScore: 19, judgeScore: 38 },
    ])
    // Self-risk alone would rank low-self-risk first; the rubric total wins.
    expect(ranked[0]!.id).toBe("high-self-risk")
    expect(ranked[0]!.reasons.some((reason) => reason.startsWith("judge:"))).toBe(true)
    expect(ranked[1]!.reasons.some((reason) => reason.startsWith("risk:"))).toBe(false)
  })

  test("judge score is clamped to 0–40", () => {
    const ranked = Arena.rankArenaCandidates([
      { id: "overflow", providerID: "a", modelID: "1", verification: "unknown", judgeScore: 99 },
      { id: "max", providerID: "b", modelID: "2", verification: "unknown", judgeScore: 40 },
    ])
    expect(ranked.find((c) => c.id === "overflow")!.score).toBe(ranked.find((c) => c.id === "max")!.score)
  })

  test("without a judge score, self-assessed risk still ranks", () => {
    const ranked = Arena.rankArenaCandidates([
      { id: "risky", providerID: "a", modelID: "1", verification: "unknown", riskScore: 15 },
      { id: "safe", providerID: "b", modelID: "2", verification: "unknown", riskScore: 2 },
    ])
    expect(ranked[0]!.id).toBe("safe")
  })
})
