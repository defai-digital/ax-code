import { describe, expect, test, vi } from "vitest"

import { API_ENDPOINTS } from "@/lib/http"
import { loadGitSettings, parseGitSettingsPayload } from "./gitSettingsLoad"

const jsonResponse = (body: unknown, ok = true): Response =>
  ({
    ok,
    json: vi.fn(async () => body),
  }) as unknown as Response

describe("gitSettingsLoad", () => {
  test("loads valid git settings from the runtime settings API first", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ gitmojiEnabled: false, gitChangesViewMode: "flat" }))

    await expect(
      loadGitSettings({
        fetchImpl,
        loadRuntimeSettings: vi.fn(async () => ({
          settings: { gitmojiEnabled: true, gitChangesViewMode: "tree" },
        })),
      }),
    ).resolves.toEqual({ gitmojiEnabled: true, gitChangesViewMode: "tree" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test("falls back to server settings when runtime settings fail", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ gitmojiEnabled: false, gitChangesViewMode: "flat" }))

    await expect(
      loadGitSettings({
        fetchImpl,
        loadRuntimeSettings: vi.fn(async () => {
          throw new Error("runtime unavailable")
        }),
      }),
    ).resolves.toEqual({ gitmojiEnabled: false, gitChangesViewMode: "flat" })
    expect(fetchImpl).toHaveBeenCalledWith(
      API_ENDPOINTS.config.settings,
      expect.objectContaining({ method: "GET", headers: { Accept: "application/json" } }),
    )
  })

  test("normalizes unsupported settings values", () => {
    expect(parseGitSettingsPayload({ gitmojiEnabled: "yes", gitChangesViewMode: "grid" })).toEqual({
      gitmojiEnabled: undefined,
      gitChangesViewMode: undefined,
    })
    expect(parseGitSettingsPayload(null)).toBeNull()
  })
})
