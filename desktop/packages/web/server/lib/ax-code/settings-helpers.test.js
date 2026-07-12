import { describe, expect, it } from "vitest"

import { createSettingsHelpers } from "./settings-helpers.js"

const createTestHelpers = (overrides = {}) =>
  createSettingsHelpers({
    normalizePathForPersistence: (value) => value,
    normalizeDirectoryPath: (value) => value,
    sanitizeTypographySizesPartial: () => undefined,
    normalizeStringArray: (input) => input,
    sanitizeModelRefs: () => undefined,
    sanitizeSkillCatalogs: () => undefined,
    sanitizeProjects: () => undefined,
    ...overrides,
  })

describe("settings helpers", () => {
  it("accepts messageStreamTransport as a persisted shared setting", () => {
    const helpers = createTestHelpers()

    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: "ws" })).toEqual({
      messageStreamTransport: "ws",
    })
    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: "sse" })).toEqual({
      messageStreamTransport: "sse",
    })
    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: "auto" })).toEqual({
      messageStreamTransport: "auto",
    })
  })

  it("rejects invalid messageStreamTransport values", () => {
    const helpers = createTestHelpers()

    expect(helpers.sanitizeSettingsUpdate({ messageStreamTransport: "websocket" })).toEqual({})
  })

  it("rejects removed LAN access and UI password settings", () => {
    const helpers = createTestHelpers()

    expect(helpers.sanitizeSettingsUpdate({ desktopLanAccessEnabled: true })).toEqual({})
    expect(helpers.sanitizeSettingsUpdate({ desktopUiPassword: "secret" })).toEqual({})
  })

  it("trims splash color settings and ignores blank values", () => {
    const helpers = createTestHelpers()

    expect(
      helpers.sanitizeSettingsUpdate({
        splashBgLight: " #ffffff ",
        splashFgLight: "   ",
        splashBgDark: "\n#111111\t",
        splashFgDark: null,
      }),
    ).toEqual({
      splashBgLight: "#ffffff",
      splashBgDark: "#111111",
    })
  })

  it("accepts collapsibleThinkingBlocks as a persisted shared setting", () => {
    const helpers = createTestHelpers()

    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: true })).toEqual({
      collapsibleThinkingBlocks: true,
    })
    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: false })).toEqual({
      collapsibleThinkingBlocks: false,
    })
  })

  it("rejects non-boolean collapsibleThinkingBlocks values", () => {
    const helpers = createTestHelpers()

    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: "true" })).toEqual({})
    expect(helpers.sanitizeSettingsUpdate({ collapsibleThinkingBlocks: 1 })).toEqual({})
  })

  it("accepts session retention and chat layout preferences", () => {
    const helpers = createTestHelpers()

    expect(
      helpers.sanitizeSettingsUpdate({
        sessionRetentionAction: "delete",
        wideChatLayoutEnabled: true,
        showTurnChangedFiles: false,
      }),
    ).toEqual({
      sessionRetentionAction: "delete",
      wideChatLayoutEnabled: true,
      showTurnChangedFiles: false,
    })
  })

  it("rejects invalid session retention and chat layout preferences", () => {
    const helpers = createTestHelpers()

    expect(
      helpers.sanitizeSettingsUpdate({
        sessionRetentionAction: "remove",
        wideChatLayoutEnabled: "true",
        showTurnChangedFiles: 0,
      }),
    ).toEqual({})
  })

  it("includes collapsibleThinkingBlocks in formatSettingsResponse", () => {
    const helpers = createTestHelpers()

    const response = helpers.formatSettingsResponse({ collapsibleThinkingBlocks: false })
    expect(response.collapsibleThinkingBlocks).toBe(false)

    const responseTrue = helpers.formatSettingsResponse({ collapsibleThinkingBlocks: true })
    expect(responseTrue.collapsibleThinkingBlocks).toBe(true)
  })

  it("defaults collapsibleThinkingBlocks to true in formatSettingsResponse when absent", () => {
    const helpers = createTestHelpers()

    const response = helpers.formatSettingsResponse({})
    expect(response.collapsibleThinkingBlocks).toBe(true)
  })

  it("sanitizes usage provider string maps with the shared filter", () => {
    const helpers = createTestHelpers()

    expect(
      helpers.sanitizeSettingsUpdate({
        usageSelectedModels: {
          openai: ["gpt-4.1", "", 42],
          empty: ["", null],
        },
        usageCollapsedFamilies: {
          openai: ["legacy", ""],
        },
        usageExpandedFamilies: {
          anthropic: ["claude", undefined],
        },
      }),
    ).toEqual({
      usageSelectedModels: { openai: ["gpt-4.1"] },
      usageCollapsedFamilies: { openai: ["legacy"] },
      usageExpandedFamilies: { anthropic: ["claude"] },
    })
  })

  it("normalizes persisted path arrays with the shared path-array filter", () => {
    const helpers = createTestHelpers({
      normalizePathForPersistence: (value) => value.trim().replace("/link/", "/real/"),
      normalizeStringArray: (input) => Array.from(new Set(input)),
    })

    expect(
      helpers.sanitizeSettingsUpdate({
        approvedDirectories: [" /link/project ", "", null, "/real/project"],
        pinnedDirectories: [" /link/pinned ", "", undefined, "/real/pinned"],
      }),
    ).toEqual({
      approvedDirectories: ["/real/project"],
      pinnedDirectories: ["/real/pinned"],
    })
  })

  it("deduplicates merged approved directories and security scoped bookmarks with the shared string filter", () => {
    const helpers = createTestHelpers()

    expect(
      helpers.mergePersistedSettings(
        {
          approvedDirectories: ["/repo", "", null, "/repo"],
          securityScopedBookmarks: ["bookmark-a", "", undefined, "bookmark-a"],
        },
        {
          lastDirectory: "/repo",
          homeDirectory: "/home/user",
          projects: [{ path: "/project" }, { path: "" }, null],
        },
      ),
    ).toMatchObject({
      approvedDirectories: ["/repo", "/home/user", "/project"],
      securityScopedBookmarks: ["bookmark-a"],
    })
  })
})
