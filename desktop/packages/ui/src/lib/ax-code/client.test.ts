import { afterEach, describe, expect, test, vi } from "vitest"

import type { RuntimeAPIs } from "../api/types"
import { axCodeClient, formatPromptSendError } from "./client"

afterEach(() => {
  axCodeClient.setDirectory(undefined)
  if (typeof window !== "undefined") {
    delete (window as typeof window & { __AX_CODE_DESKTOP_RUNTIME_APIS__?: unknown }).__AX_CODE_DESKTOP_RUNTIME_APIS__
  }
})

describe("formatPromptSendError", () => {
  test("maps ProviderModelNotFoundError to an actionable message", () => {
    const body = JSON.stringify({
      status: 400,
      errorName: "InvalidRequestError",
      error: {
        data: { providerID: "alibaba-token-plan", modelID: "qwen3.7-plus", suggestions: [] },
        name: "ProviderModelNotFoundError",
      },
    })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("maps ProviderModelNotFoundError when the error name is at the top level", () => {
    const body = JSON.stringify({ name: "ProviderModelNotFoundError" })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("maps the real stale-model envelope (details.resource = providerModel)", () => {
    // This is the actual shape ax-code returns for a stale provider/model:
    // Provider.ModelNotFoundError is normalized to InvalidRequestError with
    // details.resource = "providerModel" (server/error.ts), NOT a
    // ProviderModelNotFoundError name.
    const body = JSON.stringify({
      name: "InvalidRequestError",
      message: "Provider model not found",
      status: 400,
      details: { resource: "providerModel" },
    })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("maps the stale-model envelope by message when details are absent", () => {
    const body = JSON.stringify({ name: "InvalidRequestError", message: "Provider model not found" })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("falls back to the generic suffix form for other structured 400s", () => {
    const body = JSON.stringify({ name: "InvalidRequestError", message: "Invalid request" })
    expect(formatPromptSendError(400, body)).toBe(`Failed to send message (400): ${body}`)
  })

  test("falls back to the generic suffix form for non-JSON bodies", () => {
    expect(formatPromptSendError(500, "upstream down")).toBe("Failed to send message (500): upstream down")
  })

  test("returns a bare status message when the body is empty", () => {
    expect(formatPromptSendError(400, "")).toBe("Failed to send message (400)")
    expect(formatPromptSendError(400, "   ")).toBe("Failed to send message (400)")
  })
})

describe("axCodeClient directory normalization", () => {
  test("preserves Windows drive roots as absolute paths", () => {
    axCodeClient.setDirectory("c:/")

    expect(axCodeClient.getDirectory()).toBe("C:/")

    axCodeClient.setDirectory("C:")

    expect(axCodeClient.getDirectory()).toBe("C:/")
  })

  test("reports Windows drive-root homes as absolute paths", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("{}", { status: 500 })

    try {
      axCodeClient.setDirectory("c:/")

      await expect(axCodeClient.getSystemInfo()).resolves.toMatchObject({ homeDirectory: "C:/" })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("axCodeClient desktop file operations", () => {
  test("passes outside-workspace authorization options to the desktop files API", async () => {
    const createDirectory = vi.fn(async () => ({ success: true, path: "/tmp/approved/project" }))
    const runtimeWindow = window as typeof window & { __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs }
    runtimeWindow.__AX_CODE_DESKTOP_RUNTIME_APIS__ = {
      runtime: { platform: "desktop", isDesktop: true },
      files: {
        listDirectory: vi.fn(),
        search: vi.fn(),
        createDirectory,
      },
    } as unknown as RuntimeAPIs

    await expect(
      axCodeClient.createDirectory("/tmp/approved/project", { allowOutsideWorkspace: true }),
    ).resolves.toEqual({ success: true, path: "/tmp/approved/project" })

    expect(createDirectory).toHaveBeenCalledWith("/tmp/approved/project", { allowOutsideWorkspace: true })
  })

  test("invalidates cached directory listings after creating a directory", async () => {
    const listDirectory = vi
      .fn()
      .mockResolvedValueOnce({ directory: "/repo", entries: [] })
      .mockResolvedValueOnce({
        directory: "/repo",
        entries: [{ name: "new-folder", path: "/repo/new-folder", isDirectory: true }],
      })
    const createDirectory = vi.fn(async () => ({ success: true, path: "/repo/new-folder" }))
    const runtimeWindow = window as typeof window & { __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs }
    runtimeWindow.__AX_CODE_DESKTOP_RUNTIME_APIS__ = {
      runtime: { platform: "desktop", isDesktop: true },
      files: {
        listDirectory,
        search: vi.fn(),
        createDirectory,
      },
    } as unknown as RuntimeAPIs

    await expect(axCodeClient.listLocalDirectory("/repo")).resolves.toEqual([])
    await expect(axCodeClient.listLocalDirectory("/repo")).resolves.toEqual([])
    expect(listDirectory).toHaveBeenCalledTimes(1)

    await expect(axCodeClient.createDirectory("/repo/new-folder")).resolves.toEqual({
      success: true,
      path: "/repo/new-folder",
    })

    await expect(axCodeClient.listLocalDirectory("/repo")).resolves.toEqual([
      { name: "new-folder", path: "/repo/new-folder", isDirectory: true, isFile: false, isSymbolicLink: false },
    ])
    expect(listDirectory).toHaveBeenCalledTimes(2)
  })
})

describe("withDirectory queue resilience", () => {
  test("a hung directory-scoped call does not block subsequent calls forever", async () => {
    vi.useFakeTimers()
    try {
      // First call never settles (simulates a stalled request that previously
      // poisoned the shared directory-context queue).
      const hung = axCodeClient.withDirectory("/a", () => new Promise<string>(() => {}))
      let secondRan = false
      const second = axCodeClient.withDirectory("/b", async () => {
        secondRan = true
        return "second"
      })

      // Before the safety timeout the second call is still queued behind the hang.
      await Promise.resolve()
      expect(secondRan).toBe(false)

      // The safety timeout (15s) releases the queue so the second call can run.
      await vi.advanceTimersByTimeAsync(15_001)
      await expect(second).resolves.toBe("second")
      expect(secondRan).toBe(true)
      void hung // intentionally left pending
    } finally {
      vi.useRealTimers()
      axCodeClient.setDirectory(undefined)
    }
  })
})
