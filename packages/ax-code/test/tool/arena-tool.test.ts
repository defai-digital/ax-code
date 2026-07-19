import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("ai", () => ({ generateObject: vi.fn() }))

vi.mock("@/config/config", () => ({
  Config: { getFresh: vi.fn(), update: vi.fn(async () => ({})) },
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
    recordArenaRanking: vi.fn(async () => {}),
    load: vi.fn(async () => ({ outcomes: [] })),
    aggregateStats: vi.fn(() => new Map()),
    biasByMemory: vi.fn((c: any[]) => c),
    classifyTask: vi.fn(() => "general"),
  },
}))

vi.mock("@/project/instance", () => {
  const getter = Object.assign(
    vi.fn(() => undefined),
    { invalidate: vi.fn(async () => {}) },
  )
  return {
    Instance: {
      directory: "/tmp/test-project",
      worktree: "/tmp/test-project",
      state: vi.fn(() => getter),
      current: { directory: "/tmp/test-project", worktree: "/tmp/test-project", project: { id: "test" } },
      project: { id: "test" },
      onLifecycle: vi.fn(() => vi.fn()),
      list: vi.fn(() => []),
      bind: vi.fn((fn: any) => fn),
      containsPath: vi.fn(() => false),
      runtimeSnapshot: vi.fn(),
    },
  }
})

import { ArenaTool } from "../../src/tool/arena"
import { generateObject } from "ai"
import { Config } from "../../src/config/config"
import { EnsembleShared } from "../../src/mode/ensemble-shared"
import { ProviderID, ModelID } from "../../src/provider/schema"

const mkMembers = (ids: string[]) =>
  ids.map((id) => ({
    providerID: ProviderID.make(id),
    modelID: ModelID.make("m"),
    memberId: `${id}/m`,
  }))

const mkProposal = (riskScore: number) => ({
  approach: `Approach risk-${riskScore}`,
  steps: ["Step 1", "Step 2"],
  risks: ["Risk A"],
  riskScore,
  confidence: 0.7,
})

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

describe("arena execute()", () => {
  test("plan with 3 members all succeed → ranked output", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { arena: { enabled: true, maxContestants: 3 } },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b", "c"]),
      rejected: [],
    })
    vi.mocked(generateObject)
      .mockResolvedValueOnce({ object: mkProposal(3) } as any)
      .mockResolvedValueOnce({ object: mkProposal(7) } as any)
      .mockResolvedValueOnce({ object: mkProposal(12) } as any)

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("ok")
    expect(result.metadata.mode).toBe("plan")
    expect(result.metadata.rankedIds).toHaveLength(3)
    expect(result.output).toContain("Approaches")
  })

  test("plan with all failures → no valid proposals", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { arena: { enabled: true, maxContestants: 3 } },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b", "c"]),
      rejected: [],
    })
    vi.mocked(generateObject).mockRejectedValue(new Error("LLM down"))

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("no_successful_candidate")
    expect(result.title).toContain("no valid proposals")
  })

  test("budget exceeded → short-circuits before fan-out", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: {
        arena: { enabled: true, maxContestants: 3 },
        budget: { maxEstimatedUsd: 0.001, estimatedUsdPerMember: 0.05 },
      },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: [], rejected: [] })

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("budget_rejected")
    expect(generateObject).not.toHaveBeenCalled()
  })

  test("enableIfDisabled writes config and proceeds", async () => {
    // First getFresh: arena disabled. After Config.update, second getFresh: enabled.
    vi.mocked(Config.getFresh)
      .mockResolvedValueOnce({ modes: { arena: { enabled: false } } } as any)
      .mockResolvedValueOnce({ modes: { arena: { enabled: true, maxContestants: 3 } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b"]),
      rejected: [],
    })
    vi.mocked(generateObject)
      .mockResolvedValueOnce({ object: mkProposal(4) } as any)
      .mockResolvedValueOnce({ object: mkProposal(6) } as any)

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting", enableIfDisabled: true }, ctx)

    expect(Config.update).toHaveBeenCalledOnce()
    expect(result.metadata.enabledThisCall).toBe(true)
    expect(result.metadata.status).toBe("ok")
  })

  test("partial failure during fan-out → incomplete results preserved", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { arena: { enabled: true, maxContestants: 3 } },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b", "c"]),
      rejected: [],
    })
    // Member a fails, members b and c succeed
    vi.mocked(generateObject)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ object: mkProposal(5) } as any)
      .mockResolvedValueOnce({ object: mkProposal(8) } as any)

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    // 2/3 succeed → still "ok" since ≥2 proposals
    expect(result.metadata.status).toBe("ok")
    expect(result.metadata.errorCount).toBeGreaterThan(0)
    expect(result.metadata.rankedIds).toHaveLength(3)
    expect(result.output).toContain("Errors")
  })
})
