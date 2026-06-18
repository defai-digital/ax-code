import { describe, expect, test } from "bun:test"
import {
  formatGitHubAgentFailureMessage,
  formatGitHubAgentToolTitle,
  parseGitHubRunContextText,
} from "../../src/cli/cmd/github-agent/index"
import { Process } from "../../src/util/process"

describe("cli.github-agent.run context parsing", () => {
  test("parses mock GitHub run context JSON", () => {
    expect(
      parseGitHubRunContextText(
        JSON.stringify({
          eventName: "issue_comment",
          payload: {
            action: "created",
          },
        }),
      ),
    ).toMatchObject({
      eventName: "issue_comment",
      payload: {
        action: "created",
      },
    })
  })

  test("reports malformed mock GitHub run context JSON", () => {
    expect(() => parseGitHubRunContextText("{not json")).toThrow("Failed to parse --event as JSON")
  })
})

describe("cli.github-agent tool titles", () => {
  test("prefers explicit tool titles", () => {
    expect(formatGitHubAgentToolTitle({ title: "Read README", input: { path: "README.md" } })).toBe("Read README")
  })

  test("formats non-json-safe tool input", () => {
    const input: Record<string, unknown> = { count: 1n }
    input.self = input

    expect(formatGitHubAgentToolTitle({ input })).toBe('{"count":"1","self":"[Circular]"}')
  })

  test("falls back when tool input serialization throws", () => {
    expect(
      formatGitHubAgentToolTitle({
        input: {
          toJSON: () => {
            throw new Error("boom")
          },
        },
      }),
    ).toBe("Unknown")
  })
})

describe("cli.github-agent failure messages", () => {
  test("formats unprintable failures safely", () => {
    const failure = {
      toString() {
        throw new Error("cannot print")
      },
    }

    expect(formatGitHubAgentFailureMessage(failure)).toBe("Unknown error")
  })

  test("uses stderr for failed process runs", () => {
    const failure = new Process.RunFailedError(["git", "push"], 1, Buffer.from("stdout"), Buffer.from("denied"))

    expect(formatGitHubAgentFailureMessage(failure)).toBe("denied")
  })
})
