import { afterEach, describe, expect, it, vi } from "vitest"

import { API_ENDPOINTS, HTTP_DEFAULTS } from "./constants"
import { createWebFilesAPI } from "./files"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("createWebFilesAPI", () => {
  it("passes outside-workspace authorization options when creating directories", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, path: "/tmp/project" })))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await createWebFilesAPI().createDirectory("/tmp/project", { allowOutsideWorkspace: true })

    expect(result).toEqual({ success: true, path: "/tmp/project" })
    expect(fetchMock).toHaveBeenCalledWith(API_ENDPOINTS.files.fsMkdir, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ path: "/tmp/project", allowOutsideWorkspace: true }),
    })
  })
})
