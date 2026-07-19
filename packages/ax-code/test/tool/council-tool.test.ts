import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("ai", () => ({ generateObject: vi.fn() }))

vi.mock("@/config/config", () => ({
  Config: { getFresh: vi.fn() },
}))

vi.mock("@/provider/provider", () => ({
  Provider: {
    ready: vi.fn(async () => {}),
    list: vi.fn(async () => ({})),
    getModel: vi.fn(async () => ({})),
    getLanguage: vi.fn(async () => ({})),
    sort: vi.fn((models: any[]) => models),
  },
}))

vi.mock("@/mode/ensemble-shared", () => ({
  EnsembleShared: {
    snapshotSelectableProviders: vi.fn(async () => ({ count: 3, ids: ["a", "b", "c"] })),
    resolveMembers: vi.fn(),
  },
}))

vi.mock("@/mode/memory", () => ({
  ModeMemory: {
    recordCouncilParticipation: vi.fn(async () => {}),
    load: vi.fn(async () => ({ outcomes: [] })),
    aggregateStats: vi.fn(() => new Map()),
    biasByMemory: vi.fn((c: any[]) => c),
    classifyTask: vi.fn(() => "general"),
  },
}))

import { CouncilTool } from "../../src/tool/council"
import { generateObject } from "ai"
import { Config } from "../../src/config/config"
import { EnsembleShared } from "../../src/mode/ensemble-shared"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"

const mkMembers = (ids: string[]) =>
  ids.map((id) => ({
    providerID: ProviderID.make(id),
    modelID: ModelID.make("m"),
    memberId: `${id}/m`,
  }))

const ctx = {
  sessionID: "ses_t" as any,
  messageID: "msg_t" as any,
  agent: "test",
  abort: new AbortController().signal,
  messages: [] as any[],
  metadata: vi.fn(),
  ask: vi.fn(async () => {}),
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.clearAllMocks())

describe("council execute()", () => {
  test("3 members all succeed → consensus tier for shared issues", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { council: { enabled: true, maxMembers: 3, debateRounds: 0 } },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b", "c"]),
      rejected: [],
    })
    const issue = { severity: "high" as const, category: "security", summary: "Missing rate limit" }
    vi.mocked(generateObject).mockResolvedValue({
      object: { overall: "ok", issues: [issue] },
    } as any)

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.status).toBe("ok")
    expect(result.metadata.consensusCount).toBe(1)
    expect(result.metadata.totalMembers).toBe(3)
    expect(result.metadata.successfulMembers).toBe(3)
    expect(result.output).toContain("Consensus")
  })

  test("3 members, 1 failure → incomplete:false, correct tiers", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { council: { enabled: true, maxMembers: 3, debateRounds: 0 } },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b", "c"]),
      rejected: [],
    })
    const issue = { severity: "high" as const, category: "security", summary: "Shared issue" }
    // Members a,b succeed with same issue; member c fails (both attempts)
    vi.mocked(generateObject)
      .mockResolvedValueOnce({ object: { overall: "ok", issues: [issue] } } as any)
      .mockResolvedValueOnce({ object: { overall: "ok", issues: [issue] } } as any)
      .mockRejectedValue(new Error("LLM down"))

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.status).toBe("ok")
    expect(result.metadata.successfulMembers).toBe(2)
    expect(result.metadata.failedMembers).toBe(1)
    expect(result.metadata.consensusCount).toBe(1)
  })

  test("budget exceeded → short-circuits before fan-out", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: {
        council: { enabled: true, maxMembers: 3 },
        budget: { maxEstimatedUsd: 0.001, estimatedUsdPerMember: 0.05 },
      },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: [], rejected: [] })

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.status).toBe("budget_rejected")
    expect(generateObject).not.toHaveBeenCalled()
  })

  test("no members resolved → returns no-members output", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { council: { enabled: true, maxMembers: 3, debateRounds: 0 } },
    } as any)
    vi.mocked(EnsembleShared.snapshotSelectableProviders).mockResolvedValue({
      count: 1,
      ids: ["only-one"],
    })
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: [],
      rejected: ["No selectable model for x"],
    })

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.status).toBe("no_members")
    expect(result.metadata.totalMembers).toBe(0)
    expect(result.output).toContain("insufficient")
  })
})
