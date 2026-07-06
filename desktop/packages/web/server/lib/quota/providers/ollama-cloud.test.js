import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("ollama cloud quota provider", () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-ollama-cloud-"))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  const cookieFile = () => path.join(tempRoot, ".config", "ollama-quota", "cookie")

  const importProvider = async () => {
    vi.resetModules()
    vi.doMock("os", async (importOriginal) => {
      const actual = await importOriginal()
      return {
        ...actual,
        default: {
          ...actual.default,
          homedir: () => tempRoot,
        },
        homedir: () => tempRoot,
      }
    })
    return import("./ollama-cloud.js")
  }

  it("detects configured cookie without a preflight existence check", async () => {
    fs.mkdirSync(path.dirname(cookieFile()), { recursive: true })
    fs.writeFileSync(cookieFile(), "ollama_session=token\n", "utf8")
    const originalExistsSync = fs.existsSync
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === cookieFile()) {
        return false
      }
      return originalExistsSync(candidate)
    })

    try {
      const { isConfigured } = await importProvider()

      expect(isConfigured()).toBe(true)
    } finally {
      existsSync.mockRestore()
    }
  })

  it("uses configured cookie for quota requests without a preflight existence check", async () => {
    fs.mkdirSync(path.dirname(cookieFile()), { recursive: true })
    fs.writeFileSync(cookieFile(), "ollama_session=token\n", "utf8")
    const originalExistsSync = fs.existsSync
    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === cookieFile()) {
        return false
      }
      return originalExistsSync(candidate)
    })
    const fetch = vi.fn(async () => new Response("Session usage 25%\nWeekly usage 50%"))
    vi.stubGlobal("fetch", fetch)

    try {
      const { fetchQuota } = await importProvider()

      const result = await fetchQuota()

      expect(result.configured).toBe(true)
      expect(result.ok).toBe(true)
      expect(fetch).toHaveBeenCalledWith(
        "https://ollama.com/settings",
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: "ollama_session=token",
          }),
        }),
      )
    } finally {
      existsSync.mockRestore()
    }
  })
})
