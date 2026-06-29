import { describe, expect, it } from "vitest"
import { resolveGitHubSourceRepoOption } from "./githubSourceRepoOption"

describe("resolveGitHubSourceRepoOption", () => {
  it("returns the selected source repository without UI metadata", () => {
    expect(
      resolveGitHubSourceRepoOption({
        sourceRepo: { owner: "defai-digital", repo: "ax-code", source: "upstream" },
      }),
    ).toEqual({ owner: "defai-digital", repo: "ax-code" })
  })

  it("trims source repository fields before passing them to the API", () => {
    expect(
      resolveGitHubSourceRepoOption({
        sourceRepo: { owner: " defai-digital ", repo: " ax-code " },
      }),
    ).toEqual({ owner: "defai-digital", repo: "ax-code" })
  })

  it("returns null when there is no source repository", () => {
    expect(resolveGitHubSourceRepoOption(null)).toBeNull()
    expect(resolveGitHubSourceRepoOption({})).toBeNull()
    expect(resolveGitHubSourceRepoOption({ sourceRepo: null })).toBeNull()
  })

  it("returns null when the source repository is incomplete", () => {
    expect(resolveGitHubSourceRepoOption({ sourceRepo: { owner: "", repo: "ax-code" } })).toBeNull()
    expect(resolveGitHubSourceRepoOption({ sourceRepo: { owner: "defai-digital", repo: "" } })).toBeNull()
  })
})
