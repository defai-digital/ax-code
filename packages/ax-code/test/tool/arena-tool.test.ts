import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }))
vi.mock("ai", () => ({
  streamObject: (request: unknown) => {
    let result: any
    return {
      fullStream: (async function* () {
        result = await generateObject(request)
        if (result.streamError) yield { type: "error", error: result.streamError }
      })(),
      get object() {
        return Promise.resolve(result.object)
      },
    }
  },
}))

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

vi.mock("@/mode/ensemble-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/mode/ensemble-shared")>()
  return {
    ...actual,
    EnsembleShared: {
      snapshotSelectableProviders: vi.fn(async () => ({ count: 3, ids: ["a", "b", "c"], excluded: [] })),
      resolveMembers: vi.fn(),
    },
  }
})

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

import { ArenaTool, arenaTimeoutPolicy } from "../../src/tool/arena"
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
  test("runs two distinct models through one gateway with bounded streamed requests", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    const members = ["deepseek-v4-pro", "qwen3.8-max"].map((id) => ({
      providerID: ProviderID.make("ax-trust-defai-digital"),
      modelID: ModelID.make(id),
      memberId: `ax-trust-defai-digital/${id}`,
    }))
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members, rejected: [] })
    generateObject.mockResolvedValue({ object: mkProposal(3) })
    const tool = await ArenaTool.init()
    const result = await tool.execute(tool.parameters.parse({ task: "Review auth", providers: members }), ctx)
    expect(result.metadata.rankedIds).toHaveLength(2)
    for (const [request] of generateObject.mock.calls) {
      expect(request.maxRetries).toBe(0)
    }
    // Two proposal calls carry the proposal contract; an optional third call
    // is the blinded rubric judge (ADR-101) with its own contract.
    const systemPrompts = generateObject.mock.calls.map(([request]) => request.messages[0].content as string)
    expect(systemPrompts.filter((content) => content.includes('"approach"'))).toHaveLength(2)
  })

  test("stream errors never rank partially generated proposals", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockResolvedValue({ object: mkProposal(3), streamError: new Error("stream disconnected") })
    const result = await (await ArenaTool.init()).execute({ task: "Review auth" }, ctx)
    expect(result.metadata.errorCount).toBe(2)
    expect(result.output).not.toContain("Approach risk-3")
    expect(generateObject).toHaveBeenCalledTimes(4)
    expect(result.output).toContain("stream disconnected")
  })

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

  test("budget exceeded → short-circuits before fan-out and never asks for approval", async () => {
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
    // ADR-099: no-op preflights never consume an approval
    expect(ctx.ask).not.toHaveBeenCalled()
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
    // ADR-099: the approval gate fires before the project-config write
    expect(ctx.ask).toHaveBeenCalledTimes(1)
    expect(ctx.ask.mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(Config.update).mock.invocationCallOrder[0]!)
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

describe("arena approval boundaries", () => {
  test("disabled arena reports without asking for approval", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: false } } } as any)

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("disabled")
    expect(ctx.ask).not.toHaveBeenCalled()
  })

  test("enabled arena asks once before the fan-out", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true, maxContestants: 3 } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockResolvedValue({ object: mkProposal(3) })

    const tool = await ArenaTool.init()
    await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(ctx.ask).toHaveBeenCalledTimes(1)
  })

  test("insufficient members short-circuits without asking for approval", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a"]), rejected: [] })

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("insufficient_members")
    expect(generateObject).not.toHaveBeenCalled()
    // ADR-099: no-op preflights never consume an approval
    expect(ctx.ask).not.toHaveBeenCalled()
  })
})

describe("arena context admission (ADR-099)", () => {
  test("rejects oversized context before approval, member resolution, or inference", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting", context: "x".repeat(24_001) }, ctx)

    expect(result.metadata.status).toBe("context_rejected")
    expect(result.metadata.contextAdmission?.status).toBe("rejected")
    expect(result.output).toContain("no context was truncated")
    expect(ctx.ask).not.toHaveBeenCalled()
    expect(EnsembleShared.resolveMembers).not.toHaveBeenCalled()
    expect(generateObject).not.toHaveBeenCalled()
  })

  test("implement mode rejects oversized context before any git preflight", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)

    const tool = await ArenaTool.init()
    const result = await tool.execute(
      { task: "Add rate limiting", mode: "implement", context: "x".repeat(24_001) },
      ctx,
    )

    // The admission gate runs before inspectImplementArenaBase, so a non-git
    // directory still reports context_rejected rather than not_git.
    expect(result.metadata.status).toBe("context_rejected")
    expect(ctx.ask).not.toHaveBeenCalled()
  })

  test("context at the cap is passed to every contestant verbatim", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockResolvedValue({ object: mkProposal(3) })
    const context = `${"y".repeat(23_900)}TAIL-MARKER-0123456789`.slice(0, 24_000)

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting", context }, ctx)

    expect(result.metadata.status).toBe("ok")
    for (const [request] of generateObject.mock.calls) {
      expect(request.messages[1].content).toContain(context)
    }
  })
})

describe("arena member retry policy (ADR-099)", () => {
  test("rate-limit failures are not retried", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockRejectedValue(new Error("429 Too Many Requests: quota exceeded"))

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("no_successful_candidate")
    // One attempt per member — an immediate retry cannot fix a 429
    expect(generateObject).toHaveBeenCalledTimes(2)
  })

  test("auth failures are not retried", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockRejectedValue(new Error("401 Unauthorized"))

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("no_successful_candidate")
    expect(generateObject).toHaveBeenCalledTimes(2)
  })

  test("transient failures keep their single retry", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockRejectedValue(new Error("socket hang up"))

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.status).toBe("no_successful_candidate")
    expect(generateObject).toHaveBeenCalledTimes(4)
  })
})

describe("arenaTimeoutPolicy (ADR-099)", () => {
  test("arena knobs win over council and defaults", () => {
    expect(
      arenaTimeoutPolicy({
        arena: { timeoutMs: 42_000, reasoningTimeoutScale: 5, memberTimeoutMs: { a: 1 } },
        council: { timeoutMs: 180_000, reasoningTimeoutScale: 2, memberTimeoutMs: { b: 2 } },
      }),
    ).toEqual({ timeoutMs: 42_000, reasoningScale: 5, memberOverrides: { a: 1 } })
  })

  test("council knobs are the fallback", () => {
    expect(
      arenaTimeoutPolicy({
        council: { timeoutMs: 180_000, reasoningTimeoutScale: 2, memberTimeoutMs: { b: 2 } },
      }),
    ).toEqual({ timeoutMs: 180_000, reasoningScale: 2, memberOverrides: { b: 2 } })
  })

  test("defaults apply when nothing is configured", () => {
    expect(arenaTimeoutPolicy(undefined)).toEqual({
      timeoutMs: 60_000,
      reasoningScale: undefined,
      memberOverrides: undefined,
    })
  })
})

describe("arena rubric judge (ADR-101)", () => {
  test("ranks by the blinded rubric total, not self-assessed risk", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    let proposalCalls = 0
    generateObject.mockImplementation((request: any) => {
      const system = request.messages[0].content as string
      if (system.includes('"scores"')) {
        const user = request.messages[1].content as string
        // Blinding: the judge must not see member identities
        expect(user).not.toContain("a/m")
        expect(user).not.toContain("b/m")
        const scores = ["A", "B", "C", "D", "E"]
          .filter((label) => user.includes(`### Candidate ${label}`))
          .map((label) => {
            const block = user.slice(user.indexOf(`### Candidate ${label}`))
            const excellent = block.startsWith(`### Candidate ${label}\nApproach: Approach risk-15`)
            const value = excellent ? 10 : 1
            return {
              candidate: label,
              requirementCoverage: value,
              feasibility: value,
              verificationPlan: value,
              riskEvidence: value,
            }
          })
        return Promise.resolve({ object: { scores } })
      }
      proposalCalls++
      // Member a flatters itself (risk 3), member b is honest (risk 15)
      return Promise.resolve({ object: mkProposal(proposalCalls === 1 ? 3 : 15) })
    })

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.judge).toBe("ok")
    // Self-risk alone would rank a/m first; the rubric total ranks b/m first.
    expect(result.metadata.rankedIds?.[0]).toBe("b/m")
    expect(result.output).toContain("Judge rubric (blinded):** 40/40")
    expect(result.output).toContain("blinded candidates, randomized order")
    // 2 proposal calls + 1 judge call
    expect(generateObject).toHaveBeenCalledTimes(3)
  })

  test("modes.arena.judge: false skips the judge call", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true, judge: false } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockResolvedValue({ object: mkProposal(3) })

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.judge).toBe("disabled")
    expect(generateObject).toHaveBeenCalledTimes(2)
    expect(result.output).not.toContain("Rubric judge")
  })

  test("a failed judge falls back to self-assessed scoring with a disclosure", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({ modes: { arena: { enabled: true } } } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a", "b"]), rejected: [] })
    generateObject.mockImplementation((request: any) => {
      const system = request.messages[0].content as string
      if (system.includes('"scores"')) return Promise.reject(new Error("judge gateway 500"))
      return Promise.resolve({ object: mkProposal(3) })
    })

    const tool = await ArenaTool.init()
    const result = await tool.execute({ task: "Add rate limiting" }, ctx)

    expect(result.metadata.judge).toBe("failed")
    expect(result.metadata.judgeError).toContain("500")
    expect(result.output).toContain("Rubric judge unavailable")
    expect(result.metadata.rankedIds).toHaveLength(2)
  })
})
