import { describe, expect, it } from "vitest"
import { parseGitHubUserAttachmentUrl } from "../../src/cli/cmd/github-agent/prompts"

describe("cli.github-agent.prompts", () => {
  it("canonicalizes GitHub user attachment URLs", () => {
    const url = parseGitHubUserAttachmentUrl(
      "https://github.com/user-attachments/assets/example.png?download=1#ignored",
    )

    expect(url?.toString()).toBe("https://github.com/user-attachments/assets/example.png?download=1")
  })

  it("rejects non-GitHub and non-attachment URLs", () => {
    expect(parseGitHubUserAttachmentUrl("https://github.com.evil.test/user-attachments/assets/example.png")).toBeNull()
    expect(parseGitHubUserAttachmentUrl("http://github.com/user-attachments/assets/example.png")).toBeNull()
    expect(parseGitHubUserAttachmentUrl("https://github.com/settings/profile")).toBeNull()
  })
})
