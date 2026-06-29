import { afterEach, describe, expect, it, vi } from "vitest"

import { API_ENDPOINTS, HTTP_DEFAULTS } from "./constants"
import { createWebFilesAPI } from "./files"

const originalFetch = globalThis.fetch
const originalDocument = globalThis.document

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.document = originalDocument
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

  it("passes outside-workspace authorization options when downloading files", async () => {
    const click = vi.fn()
    const anchor = { href: "", download: "", click }
    const appendChild = vi.fn()
    const removeChild = vi.fn()
    globalThis.document = {
      createElement: vi.fn(() => anchor),
      body: { appendChild, removeChild },
    } as unknown as Document

    await createWebFilesAPI().downloadFile?.("/tmp/approved/image.png", { allowOutsideWorkspace: true })

    expect(anchor.href).toBe("/api/fs/raw?path=%2Ftmp%2Fapproved%2Fimage.png&download=true&allowOutsideWorkspace=true")
    expect(anchor.download).toBe("image.png")
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalled()
    expect(removeChild).toHaveBeenCalledWith(anchor)
  })
})
