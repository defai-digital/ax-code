import { afterEach, expect, test, vi, type MockInstance } from "vitest"
import {
  aggregateSessionStats,
  displayStats,
  validateStatsDays,
  validateStatsDisplayLimit,
} from "../../src/cli/cmd/stats"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionShard } from "../../src/session/shard"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionUsageStats } from "../../src/session/usage-stats"
import type { MessageV2 } from "../../src/session/message-v2"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

let messagesSpy: { mockRestore(): void } | undefined
let warnSpy: MockInstance | undefined

afterEach(() => {
  messagesSpy?.mockRestore()
  warnSpy?.mockRestore()
  messagesSpy = undefined
  warnSpy = undefined
})

test("displayStats respects toolLimit=0 by hiding tool rows", () => {
  const logs: string[] = []
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "))
  })

  try {
    displayStats(
      {
        totalSessions: 1,
        totalMessages: 1,
        totalTokens: {
          input: 10,
          output: 5,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        toolUsage: {
          bash: 3,
          grep: 2,
        },
        modelUsage: {},
        dateRange: {
          earliest: 0,
          latest: 0,
        },
        days: 1,
        tokensPerSession: 15,
        medianTokensPerSession: 15,
      } as any,
      0,
    )
  } finally {
    logSpy.mockRestore()
  }

  const output = logs.join("\n")
  expect(output).toContain("TOOL USAGE")
  expect(output).not.toContain("bash")
  expect(output).not.toContain("grep")
})

test("displayStats sanitizes non-finite numbers", () => {
  const logs: string[] = []
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "))
  })
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)

  try {
    displayStats(
      {
        totalSessions: Infinity,
        totalMessages: Number.NaN,
        totalTokens: {
          input: Infinity,
          output: Number.NaN,
          reasoning: 0,
          cache: { read: Infinity, write: Number.NaN },
        },
        toolUsage: {
          bash: Infinity,
          grep: Number.NaN,
        },
        modelUsage: {
          "test/model": {
            messages: Infinity,
            tokens: {
              input: Infinity,
              output: Number.NaN,
              cache: { read: Infinity, write: Number.NaN },
            },
          },
        },
        dateRange: {
          earliest: 0,
          latest: 0,
        },
        days: Infinity,
        tokensPerSession: Infinity,
        medianTokensPerSession: Number.NaN,
      } as any,
      undefined,
      Infinity,
    )
  } finally {
    logSpy.mockRestore()
    writeSpy.mockRestore()
  }

  const output = logs.join("\n")
  expect(output).toContain("OVERVIEW")
  expect(output).toContain("TOKEN USAGE")
  expect(output).toContain("MODEL USAGE")
  expect(output).toContain("TOOL USAGE")
  expect(output).not.toContain("Infinity")
  expect(output).not.toContain("NaN")
})

test("validateStatsDays rejects invalid time windows", () => {
  expect(validateStatsDays(undefined)).toBeUndefined()
  expect(validateStatsDays(0)).toBe(0)
  expect(validateStatsDays(7)).toBe(7)

  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "7"]) {
    expect(() => validateStatsDays(value)).toThrow("--days must be a non-negative integer")
  }
})

test("validateStatsDisplayLimit rejects invalid display limits", () => {
  expect(validateStatsDisplayLimit(undefined, "--tools")).toBeUndefined()
  expect(validateStatsDisplayLimit(0, "--tools")).toBe(0)
  expect(validateStatsDisplayLimit(5, "--models")).toBe(5)

  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "5"]) {
    expect(() => validateStatsDisplayLimit(value, "--tools")).toThrow("--tools must be a non-negative integer")
  }
})

test("aggregateSessionStats skips a store whose usage query fails with an unprintable reason", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await Session.create({})
      const second = await Session.create({})
      const failure = {
        toString() {
          throw new Error("cannot print")
        },
      }
      messagesSpy = vi.spyOn(SessionUsageStats, "load").mockImplementation(() => {
        throw failure
      })
      const warnings: string[] = []
      warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
        warnings.push(args.join(" "))
      })

      const stats = await aggregateSessionStats(undefined, "")

      expect(stats.totalSessions).toBe(2)
      expect(stats.totalMessages).toBe(0)
      // Failed sessions contribute no usage: the mean must not treat them as
      // zero-token sessions, and the day count must not fall back to an
      // inverted sentinel range (which used to report 1 day for all-time).
      expect(stats.tokensPerSession).toBe(0)
      expect(stats.days).toBe(0)
      expect(warnings.join("\n")).toContain("Warning: stats batch failed: Unknown error")

      await Session.remove(first.id)
      await Session.remove(second.id)
    },
  })
})

async function addUser(sessionID: SessionID) {
  return Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "p", modelID: "m" },
    tools: {},
    mode: "build",
  } as unknown as MessageV2.User)
}

async function addAssistant(
  sessionID: SessionID,
  directory: string,
  parentID: MessageID,
  input: { model: string; tokens: [number, number, number, number, number] },
) {
  const [inp, out, reasoning, read, write] = input.tokens
  return Session.updateMessage({
    id: MessageID.ascending(),
    parentID,
    sessionID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    tokens: { input: inp, output: out, reasoning, cache: { read, write } },
    modelID: input.model,
    providerID: "prov",
    time: { created: Date.now() },
  } as MessageV2.Assistant)
}

async function addToolPart(sessionID: SessionID, messageID: MessageID, tool: string) {
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "tool",
    callID: `call-${PartID.ascending()}`,
    tool,
    state: { status: "completed", input: {}, output: "ok", title: tool, metadata: {}, time: { start: 1, end: 2 } },
  } as MessageV2.ToolPart)
}

test("aggregateSessionStats sums tokens, model usage, and tool calls inside SQLite", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = await Session.create({})
      const second = await Session.create({})

      const user1 = await addUser(first.id)
      const a1 = await addAssistant(first.id, tmp.path, user1.id, { model: "alpha", tokens: [10, 5, 2, 1, 3] })
      const a2 = await addAssistant(first.id, tmp.path, user1.id, { model: "alpha", tokens: [20, 6, 0, 4, 0] })
      await addToolPart(first.id, a1.id, "bash")
      await addToolPart(first.id, a1.id, "bash")
      await addToolPart(first.id, a2.id, "read")

      const user2 = await addUser(second.id)
      const b1 = await addAssistant(second.id, tmp.path, user2.id, { model: "beta", tokens: [7, 1, 1, 0, 0] })
      await addToolPart(second.id, b1.id, "bash")

      const stats = await aggregateSessionStats(undefined, "")

      expect(stats.totalSessions).toBe(2)
      expect(stats.totalMessages).toBe(5)
      expect(stats.totalTokens).toEqual({ input: 37, output: 12, reasoning: 3, cache: { read: 5, write: 3 } })
      expect(stats.toolUsage).toEqual({ bash: 3, read: 1 })
      expect(stats.modelUsage["prov/alpha"]).toEqual({
        messages: 2,
        tokens: { input: 30, output: 13, cache: { read: 5, write: 3 } },
      })
      expect(stats.modelUsage["prov/beta"]).toEqual({
        messages: 1,
        tokens: { input: 7, output: 2, cache: { read: 0, write: 0 } },
      })
      // Per-session totals: first = 10+5+2+1+3 + 20+6+0+4+0 = 51, second = 9.
      expect(stats.medianTokensPerSession).toBe(30)
      expect(stats.tokensPerSession).toBe(30)

      await Session.remove(first.id)
      await Session.remove(second.id)
    },
  })
})

test("SessionUsageStats.load restricts to the requested sessions and tolerates sessions without messages", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const used = await Session.create({})
      const empty = await Session.create({})
      const user = await addUser(used.id)
      await addAssistant(used.id, tmp.path, user.id, { model: "alpha", tokens: [1, 2, 3, 4, 5] })

      const store = SessionShard.storeForProject(used.projectID)
      const onlyEmpty = SessionUsageStats.load(store, [empty.id])
      expect(onlyEmpty.get(used.id)).toBeUndefined()
      expect(onlyEmpty.get(empty.id)).toBeUndefined()

      const both = SessionUsageStats.load(store, [used.id, empty.id])
      expect(both.get(used.id)?.messageCount).toBe(2)
      expect(both.get(empty.id)).toBeUndefined()
      expect(SessionUsageStats.load(store, [])).toEqual(new Map())

      await Session.remove(used.id)
      await Session.remove(empty.id)
    },
  })
})
