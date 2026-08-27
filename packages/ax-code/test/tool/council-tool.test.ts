import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("ai", () => ({ generateObject: vi.fn(), generateText: vi.fn() }))

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
    snapshotSelectableProviders: vi.fn(async () => ({ count: 3, ids: ["a", "b", "c"], excluded: [] })),
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

import { CouncilTool, DEFAULT_REASONING_TIMEOUT_SCALE, DEFAULT_TIMEOUT_MS } from "../../src/tool/council"
import { generateObject, generateText } from "ai"
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
      excluded: [],
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

describe("council member robustness", () => {
  const singleMemberConfig = (council: Record<string, unknown> = {}) =>
    ({ modes: { council: { enabled: true, maxMembers: 1, debateRounds: 0, ...council } } }) as any
  const oneMember = () =>
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a"]), rejected: [] })

  test("generateObject schema failure falls back to generateText JSON", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue(singleMemberConfig())
    oneMember()
    vi.mocked(generateObject).mockRejectedValue(new Error("No object generated: response did not match schema."))
    vi.mocked(generateText).mockResolvedValue({
      text: '```json\n{"overall":"recovered","issues":[{"severity":"HIGH","category":"security","summary":"Missing rate limit"}]}\n```',
    } as any)

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(generateText).toHaveBeenCalledTimes(1)
    expect(result.metadata.successfulMembers).toBe(1)
    expect(result.metadata.failedMembers).toBe(0)
    // Severity normalization still applies to the fallback path.
    expect(result.output).toContain("[high]")
    expect(result.output).toContain("Missing rate limit")
  })

  test("member fails when the generateText fallback is also unparseable", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue(singleMemberConfig())
    oneMember()
    vi.mocked(generateObject).mockRejectedValue(new Error("No object generated: could not parse the response."))
    vi.mocked(generateText).mockResolvedValue({ text: "I cannot comply." } as any)

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.failedMembers).toBe(1)
    expect(result.metadata.successfulMembers).toBe(0)
  })

  test("incompatible specificationVersion is reported as a provider package error", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue(singleMemberConfig())
    oneMember()
    vi.mocked(generateObject).mockRejectedValue(
      new Error(
        'Unsupported model version v4 for provider "anthropic" and model "claude-sonnet-4-5". ' +
          'AI SDK 5 only supports models that implement specification version "v2".',
      ),
    )

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    // The spec error must not trigger the JSON fallback.
    expect(generateText).not.toHaveBeenCalled()
    expect(result.metadata.failedMembers).toBe(1)
    expect(result.output).toContain('provider package for "a" is incompatible with this ax-code build')
  })
})

describe("council timeout", () => {
  const singleMemberConfig = (council: Record<string, unknown> = {}) =>
    ({ modes: { council: { enabled: true, maxMembers: 1, debateRounds: 0, ...council } } }) as any
  const oneMember = () =>
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({ members: mkMembers(["a"]), rejected: [] })
  // Hang until the member abort signal fires so the per-member timeout triggers.
  const hangUntilAbort = () =>
    vi.mocked(generateObject).mockImplementation(
      ({ abortSignal }: any) =>
        new Promise((_, reject) => {
          abortSignal.addEventListener("abort", () => reject(new Error("This operation was aborted")))
        }),
    )

  test("default timeout is generous enough for reasoning models", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(180_000)
  })

  test("timeout error directs the USER to raise modes.council.timeoutMs", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue(singleMemberConfig({ timeoutMs: 1 }))
    oneMember()
    hangUntilAbort()

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.failedMembers).toBe(1)
    expect(result.output).toContain("timeout: member exceeded 1ms")
    expect(result.output).toContain("Ask the USER to raise modes.council.timeoutMs")
    expect(result.output).toContain("modes.council.memberTimeoutMs")
    expect(result.output).toContain("agents cannot edit that protected config file")
  })

  test("reasoning members get a scaled timeout", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue(singleMemberConfig({ timeoutMs: 1 }))
    oneMember()
    vi.mocked(Provider.getModel).mockResolvedValue({ capabilities: { reasoning: true } } as any)
    hangUntilAbort()

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.failedMembers).toBe(1)
    expect(result.output).toContain(`timeout: member exceeded ${1 * DEFAULT_REASONING_TIMEOUT_SCALE}ms`)
  })

  test("memberTimeoutMs override beats the reasoning scale", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue(singleMemberConfig({ timeoutMs: 1, memberTimeoutMs: { "a/m": 42 } }))
    oneMember()
    vi.mocked(Provider.getModel).mockResolvedValue({ capabilities: { reasoning: true } } as any)
    hangUntilAbort()

    const tool = await CouncilTool.init()
    const result = await tool.execute({ question: "Review auth" }, ctx)

    expect(result.metadata.failedMembers).toBe(1)
    expect(result.output).toContain("timeout: member exceeded 42ms")
  })
})

describe("council request shaping", () => {
  test("every member request carries a bounded output limit", async () => {
    vi.mocked(Config.getFresh).mockResolvedValue({
      modes: { council: { enabled: true, maxMembers: 3, debateRounds: 0 } },
    } as any)
    vi.mocked(EnsembleShared.resolveMembers).mockResolvedValue({
      members: mkMembers(["a", "b"]),
      rejected: [],
    })
    vi.mocked(generateObject).mockResolvedValue({ object: { overall: "ok", issues: [] } } as any)

    const tool = await CouncilTool.init()
    await tool.execute({ question: "Review auth" }, ctx)

    // Gateways such as AX Trust reject a chat completion that carries
    // neither max_tokens nor max_completion_tokens; the prompt path always
    // sends one, and aux calls must too.
    expect(vi.mocked(generateObject).mock.calls.length).toBeGreaterThan(0)
    for (const [request] of vi.mocked(generateObject).mock.calls) {
      expect(request.maxOutputTokens).toEqual(expect.any(Number))
      expect(request.maxOutputTokens).toBeGreaterThan(0)
    }
  })
})
