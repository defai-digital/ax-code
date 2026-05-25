import { describe, expect, test } from "bun:test"
import { parseGitHubRunContextText } from "../../src/cli/cmd/github-agent/index"

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
