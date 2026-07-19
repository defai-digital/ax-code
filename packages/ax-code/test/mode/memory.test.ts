import fs from "fs/promises"
import path from "path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ModeMemory } from "../../src/mode/memory"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

describe("ModeMemory pure helpers", () => {
  test("classifyTask detects security", () => {
    expect(ModeMemory.classifyTask("scan for XSS vulnerabilities")).toBe("security")
  })

  test("aggregateStats ranks winners", () => {
    const stats = ModeMemory.aggregateStats(
      [
        {
          taskClass: "implement",
          providerID: "google",
          modelID: "a",
          result: "win",
          at: 1,
        },
        {
          taskClass: "implement",
          providerID: "google",
          modelID: "a",
          result: "win",
          at: 2,
        },
        {
          taskClass: "implement",
          providerID: "openrouter",
          modelID: "b",
          result: "fail",
          at: 3,
        },
      ],
      "implement",
    )
    expect(stats[0]!.providerID).toBe("google")
    expect(stats[0]!.wins).toBe(2)
    expect(stats[0]!.score).toBeGreaterThan(stats[1]!.score)
  })

  test("biasByMemory reorders candidates", () => {
    const stats: ModeMemory.Stats[] = [
      {
        providerID: "weak",
        modelID: "x",
        wins: 0,
        places: 0,
        fails: 2,
        participates: 0,
        score: -2,
      },
      {
        providerID: "strong",
        modelID: "y",
        wins: 3,
        places: 0,
        fails: 0,
        participates: 0,
        score: 9,
      },
    ]
    const ordered = ModeMemory.biasByMemory(
      [
        { providerID: "weak", modelID: "x" },
        { providerID: "strong", modelID: "y" },
      ],
      stats,
    )
    expect(ordered[0]!.providerID).toBe("strong")
  })
})

describe("ModeMemory I/O (file-backed store)", () => {
  let prev: string
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    tmp = await tmpdir()
    prev = Global.Path.state
    ;(Global.Path as { state: string }).state = tmp.path
  })

  afterEach(async () => {
    ;(Global.Path as { state: string }).state = prev
    await tmp[Symbol.asyncDispose]()
  })

  test("append() then load() roundtrips outcomes", async () => {
    const outcomes: ModeMemory.Outcome[] = [
      { taskClass: "implement", providerID: "openai", modelID: "gpt-4o", result: "win", at: 1000 },
      { taskClass: "debug", providerID: "anthropic", modelID: "claude-3-opus", result: "place", at: 2000 },
    ]
    await ModeMemory.append(outcomes)
    const store = await ModeMemory.load()
    expect(store.version).toBe(1)
    expect(store.outcomes).toHaveLength(2)
    expect(store.outcomes[0]!.providerID).toBe("openai")
    expect(store.outcomes[1]!.result).toBe("place")
  })

  test("append() with empty array is a no-op", async () => {
    await ModeMemory.append([])
    const store = await ModeMemory.load()
    expect(store.outcomes).toHaveLength(0)
  })

  test("MAX_OUTCOMES cap keeps only the latest 2000 outcomes", async () => {
    // Append 2100 outcomes in a single call
    const bulk: ModeMemory.Outcome[] = Array.from({ length: 2100 }, (_, i) => ({
      taskClass: "general" as const,
      providerID: `p${i}`,
      modelID: "m",
      result: "participate" as const,
      at: i,
    }))
    await ModeMemory.append(bulk)
    const store = await ModeMemory.load()
    // Only the last 2000 should survive
    expect(store.outcomes.length).toBeLessThanOrEqual(2000)
    // The earliest outcomes (p0..p99) should have been trimmed
    expect(store.outcomes[0]!.providerID).toBe("p100")
    expect(store.outcomes.at(-1)!.providerID).toBe("p2099")
  })

  test("recordArenaRanking() persists win/place/participate/fail outcomes", async () => {
    await ModeMemory.recordArenaRanking({
      task: "Fix the XSS vulnerability in the auth handler",
      rankedIds: ["anthropic/claude-3-opus", "openai/gpt-4o", "google/gemini-pro"],
      failedIds: ["groq/llama-3"],
    })
    const store = await ModeMemory.load()
    expect(store.outcomes.length).toBe(4)
    // Task should be classified as security
    expect(store.outcomes.every((o) => o.taskClass === "security")).toBe(true)
    // First ranked → win
    expect(store.outcomes[0]!.providerID).toBe("anthropic")
    expect(store.outcomes[0]!.result).toBe("win")
    // Second ranked → place
    expect(store.outcomes[1]!.result).toBe("place")
    // Third ranked → participate
    expect(store.outcomes[2]!.result).toBe("participate")
    // Failed → fail
    expect(store.outcomes[3]!.result).toBe("fail")
  })

  test("recordCouncilParticipation() persists participate/fail per member", async () => {
    await ModeMemory.recordCouncilParticipation({
      question: "Review the PR for code quality issues",
      memberIds: ["openai/gpt-4o", "anthropic/claude-3-opus", "google/gemini-pro"],
      successfulIds: ["openai/gpt-4o", "google/gemini-pro"],
    })
    const store = await ModeMemory.load()
    expect(store.outcomes.length).toBe(3)
    // Task should be classified as review
    expect(store.outcomes.every((o) => o.taskClass === "review")).toBe(true)
    const byId = new Map(store.outcomes.map((o) => [o.providerID, o.result]))
    expect(byId.get("openai")).toBe("participate")
    expect(byId.get("anthropic")).toBe("fail")
    expect(byId.get("google")).toBe("participate")
  })

  test("concurrent append() calls are serialized (no data loss)", async () => {
    const batch1: ModeMemory.Outcome[] = [
      { taskClass: "implement", providerID: "a", modelID: "m", result: "win", at: 1 },
    ]
    const batch2: ModeMemory.Outcome[] = [
      { taskClass: "implement", providerID: "b", modelID: "n", result: "place", at: 2 },
    ]
    const batch3: ModeMemory.Outcome[] = [
      { taskClass: "implement", providerID: "c", modelID: "o", result: "fail", at: 3 },
    ]
    // Fire all three concurrently
    await Promise.all([ModeMemory.append(batch1), ModeMemory.append(batch2), ModeMemory.append(batch3)])
    const store = await ModeMemory.load()
    expect(store.outcomes).toHaveLength(3)
    const providers = store.outcomes.map((o) => o.providerID).sort()
    expect(providers).toEqual(["a", "b", "c"])
  })

  test("atomic write: store file is written via .tmp rename (no partial writes)", async () => {
    await ModeMemory.append([{ taskClass: "general", providerID: "x", modelID: "y", result: "win", at: 42 }])
    // The .tmp file should NOT exist after a successful write
    const tmpFile = path.join(tmp.path, "mode-ensemble-memory.json.tmp")
    await expect(fs.stat(tmpFile)).rejects.toThrow()
    // The real store file should exist and contain valid JSON
    const storeFile = path.join(tmp.path, "mode-ensemble-memory.json")
    const raw = await fs.readFile(storeFile, "utf8")
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(parsed.outcomes).toHaveLength(1)
  })
})
