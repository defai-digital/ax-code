import { expect, spyOn, test } from "bun:test"
import { displayStats } from "../../src/cli/cmd/stats"

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
