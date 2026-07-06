import { afterEach, describe, expect, it, vi } from "vitest"
import { getUserPrompt, parseGitHubUserAttachmentUrl } from "../../src/cli/cmd/github-agent/prompts"
import { Ssrf } from "../../src/util/ssrf"

const ORIGINAL_PROMPT = process.env["PROMPT"]

afterEach(() => {
  if (ORIGINAL_PROMPT === undefined) delete process.env["PROMPT"]
  else process.env["PROMPT"] = ORIGINAL_PROMPT
  vi.restoreAllMocks()
})

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

  it("does not log user-controlled attachment URLs when downloads fail", async () => {
    delete process.env["PROMPT"]
    const attachmentUrl = "https://github.com/user-attachments/assets/example.png?token=secret"
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue(new Response("nope", { status: 500 }) as never)
    const payload = {
      comment: {
        body: `/ax-code please inspect ![screenshot](${attachmentUrl})`,
      },
    } as Parameters<typeof getUserPrompt>[0]["payload"]

    const result = await getUserPrompt({
      eventName: "issue_comment",
      isRepoEvent: false,
      isIssuesEvent: false,
      isCommentEvent: true,
      appToken: "github-token",
      payload,
    })

    expect(result).toEqual({
      userPrompt: `/ax-code please inspect ![screenshot](${attachmentUrl})`,
      promptFiles: [],
    })
    expect(errorSpy).toHaveBeenCalledWith("Failed to download GitHub attachment: HTTP 500")
    expect(errorSpy.mock.calls.flat().join("\n")).not.toContain(attachmentUrl)
    expect(errorSpy.mock.calls.flat().join("\n")).not.toContain("secret")
  })
})
