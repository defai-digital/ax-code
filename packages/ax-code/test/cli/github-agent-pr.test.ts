import { describe, expect, test } from "bun:test"
import { decodeGitHubPrViewInfoValue, parseGitHubPrViewInfoText } from "../../src/cli/cmd/github-agent/pr"

describe("cli.github-agent.pr", () => {
  test("decodeGitHubPrViewInfoValue decodes the gh pr view fields used by checkout", () => {
    expect(
      decodeGitHubPrViewInfoValue({
        isCrossRepository: true,
        headRepository: { name: "forked-repo", extra: true },
        headRepositoryOwner: { login: "alice" },
        headRefName: "feature",
        body: "Session: https://example.com/s/session_123",
        ignored: "value",
      }),
    ).toEqual({
      isCrossRepository: true,
      headRepository: { name: "forked-repo" },
      headRepositoryOwner: { login: "alice" },
      headRefName: "feature",
      body: "Session: https://example.com/s/session_123",
    })
  })

  test("decodeGitHubPrViewInfoValue drops malformed optional fields", () => {
    expect(
      decodeGitHubPrViewInfoValue({
        isCrossRepository: "true",
        headRepository: { name: 123 },
        headRepositoryOwner: { login: null },
        headRefName: false,
        body: ["not", "text"],
      }),
    ).toEqual({})
    expect(decodeGitHubPrViewInfoValue(null)).toBeUndefined()
    expect(decodeGitHubPrViewInfoValue([])).toBeUndefined()
  })

  test("parseGitHubPrViewInfoText parses JSON through the same value decoder", () => {
    expect(
      parseGitHubPrViewInfoText(
        JSON.stringify({
          isCrossRepository: false,
          body: "No linked session",
        }),
      ),
    ).toEqual({
      isCrossRepository: false,
      body: "No linked session",
    })
    expect(() => parseGitHubPrViewInfoText("{not json")).toThrow(/Failed to parse PR info from gh CLI/)
  })
})
