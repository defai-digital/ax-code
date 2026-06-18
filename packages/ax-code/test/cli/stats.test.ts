import { afterEach, expect, spyOn, test } from "bun:test"
import { aggregateSessionStats, displayStats } from "../../src/cli/cmd/stats"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

let messagesSpy: { mockRestore(): void } | undefined
let warnSpy: ReturnType<typeof spyOn<typeof console, "warn">> | undefined

afterEach(() => {
  messagesSpy?.mockRestore()
  warnSpy?.mockRestore()
  messagesSpy = undefined
  warnSpy = undefined
})

test("displayStats respects toolLimit=0 by hiding tool rows", () => {
  const logs: string[] = []
  const logSpy = spyOn(console, "log").mockImplementation((...args) => {
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
  const logSpy = spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "))
  })
  const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true)

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

test("aggregateSessionStats skips sessions whose messages fail with an unprintable reason", async () => {
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
      const sessionMessagesTarget = Session as unknown as {
        messages(input: Parameters<typeof Session.messages>[0]): Promise<Awaited<ReturnType<typeof Session.messages>>>
      }
      messagesSpy = spyOn(sessionMessagesTarget, "messages").mockImplementation(async (input) => {
        if (input.sessionID === first.id) throw failure
        return []
      })
      const warnings: string[] = []
      warnSpy = spyOn(console, "warn").mockImplementation((...args) => {
        warnings.push(args.join(" "))
      })

      const stats = await aggregateSessionStats(undefined, "")

      expect(stats.totalSessions).toBe(2)
      expect(stats.totalMessages).toBe(0)
      expect(warnings.join("\n")).toContain("Warning: stats batch failed: Unknown error")

      await Session.remove(first.id)
      await Session.remove(second.id)
    },
  })
})
