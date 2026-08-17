import { describe, expect, test, vi } from "vitest"
import {
  githubRequest,
  isRetryableStatus,
  matchingUploadedAsset,
  releaseUploadUrl,
  selectReleaseByTag,
} from "./github-release-assets.mjs"

describe("GitHub draft release assets", () => {
  test("selects draft releases by their exact tag", () => {
    expect(
      selectReleaseByTag(
        [
          { id: 1, tag_name: "desktop-v7.6.0", draft: false },
          { id: 2, tag_name: "desktop-v7.6.1", draft: true },
        ],
        "desktop-v7.6.1",
      ),
    ).toMatchObject({ id: 2, draft: true })
  })

  test("rejects missing and ambiguous releases", () => {
    expect(() => selectReleaseByTag([], "v1.0.0")).toThrow("was not found")
    expect(() =>
      selectReleaseByTag(
        [
          { id: 1, tag_name: "v1.0.0" },
          { id: 2, tag_name: "v1.0.0" },
        ],
        "v1.0.0",
      ),
    ).toThrow("ambiguous")
  })

  test("builds an encoded release upload URL", () => {
    expect(
      releaseUploadUrl(
        { upload_url: "https://uploads.github.com/repos/acme/app/releases/42/assets{?name,label}" },
        "AX Code arm64.yml",
      ),
    ).toBe("https://uploads.github.com/repos/acme/app/releases/42/assets?name=AX%20Code%20arm64.yml")
  })

  test("classifies transient GitHub responses", () => {
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(404)).toBe(false)
  })

  test("reconciles ambiguous upload responses by exact name and size", () => {
    const assets = [
      { id: 1, name: "latest.yml", size: 1_024 },
      { id: 2, name: "latest.yml", size: 2_048 },
    ]
    expect(matchingUploadedAsset(assets, "latest.yml", 2_048)).toMatchObject({ id: 2 })
    expect(matchingUploadedAsset(assets, "latest.yml", 4_096)).toBeUndefined()
  })

  test("retries transient API failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const log = vi.fn()

    const response = await githubRequest(
      "https://api.github.com/repos/acme/app/releases",
      {},
      { fetchImpl, sleepImpl, retryDelaysMs: [0], token: "test-token", log },
    )

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledWith(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("returned 503"))
  })
})
