import { describe, expect, test } from "vitest"

import {
  CONTEXT_PANEL_TAB_LABEL_MAX_CHARS,
  getContextPanelFileNameFromPath,
  getContextPanelModeLabel,
  getContextPanelSessionIDFromDedupeKey,
  getContextPanelTabLabel,
  normalizeContextPanelDirectoryKey,
  truncateContextPanelTabLabel,
  type ContextPanelTranslateFn,
} from "./contextPanelTabs"

const t: ContextPanelTranslateFn = (key) => key

describe("normalizeContextPanelDirectoryKey", () => {
  test("returns an empty string for empty input", () => {
    expect(normalizeContextPanelDirectoryKey("")).toBe("")
  })

  test("converts backslashes to forward slashes", () => {
    expect(normalizeContextPanelDirectoryKey("C:\\Users\\alice\\project")).toBe("C:/Users/alice/project")
  })

  test("strips trailing slashes and collapses repeated slashes", () => {
    expect(normalizeContextPanelDirectoryKey("/repo/project///")).toBe("/repo/project")
    expect(normalizeContextPanelDirectoryKey("/repo//nested///project")).toBe("/repo/nested/project")
  })

  test("preserves the UNC double-slash prefix", () => {
    expect(normalizeContextPanelDirectoryKey("//server/share/project/")).toBe("//server/share/project")
  })

  test("keeps a lone root slash", () => {
    expect(normalizeContextPanelDirectoryKey("/")).toBe("/")
    expect(normalizeContextPanelDirectoryKey("///")).toBe("/")
  })
})

describe("getContextPanelFileNameFromPath", () => {
  test("returns null for missing or blank paths", () => {
    expect(getContextPanelFileNameFromPath(null)).toBeNull()
    expect(getContextPanelFileNameFromPath("")).toBeNull()
    expect(getContextPanelFileNameFromPath("   ")).toBeNull()
  })

  test("returns the last segment of POSIX and Windows paths", () => {
    expect(getContextPanelFileNameFromPath("/repo/src/app.ts")).toBe("app.ts")
    expect(getContextPanelFileNameFromPath("C:\\repo\\src\\app.ts")).toBe("app.ts")
  })

  test("ignores trailing slashes when picking the last segment", () => {
    expect(getContextPanelFileNameFromPath("/repo/src/")).toBe("src")
  })

  test("returns the whole value when there are no segments", () => {
    expect(getContextPanelFileNameFromPath("/")).toBe("/")
    expect(getContextPanelFileNameFromPath("file.ts")).toBe("file.ts")
  })
})

describe("getContextPanelModeLabel", () => {
  test("maps each mode to its i18n key", () => {
    expect(getContextPanelModeLabel("chat", t)).toBe("contextPanel.mode.chat")
    expect(getContextPanelModeLabel("file", t)).toBe("contextPanel.mode.files")
    expect(getContextPanelModeLabel("diff", t)).toBe("contextPanel.mode.diff")
    expect(getContextPanelModeLabel("plan", t)).toBe("contextPanel.mode.plan")
    expect(getContextPanelModeLabel("preview", t)).toBe("contextPanel.mode.preview")
    expect(getContextPanelModeLabel("browser", t)).toBe("contextPanel.mode.browser")
    expect(getContextPanelModeLabel("context", t)).toBe("contextPanel.mode.context")
  })

  test("returns a hardcoded label for dashboard mode", () => {
    expect(getContextPanelModeLabel("dashboard", t)).toBe("Dashboard")
  })
})

describe("getContextPanelTabLabel", () => {
  test("prefers an explicit tab label over derived labels", () => {
    expect(getContextPanelTabLabel({ mode: "file", label: "Custom", targetPath: "/a/b.ts" }, t)).toBe("Custom")
  })

  test("derives file tab labels from the target path", () => {
    expect(getContextPanelTabLabel({ mode: "file", label: null, targetPath: "/repo/app.ts" }, t)).toBe("app.ts")
    expect(getContextPanelTabLabel({ mode: "file", label: null, targetPath: null }, t)).toBe(
      "contextPanel.mode.files",
    )
  })

  test("derives preview tab labels from the URL host", () => {
    expect(
      getContextPanelTabLabel({ mode: "preview", label: null, targetPath: "http://localhost:3000/app" }, t),
    ).toBe("localhost:3000")
  })

  test("falls back to the preview label for missing or invalid URLs", () => {
    expect(getContextPanelTabLabel({ mode: "preview", label: null, targetPath: null }, t)).toBe(
      "contextPanel.mode.preview",
    )
    expect(getContextPanelTabLabel({ mode: "preview", label: null, targetPath: "not a url" }, t)).toBe(
      "contextPanel.mode.preview",
    )
  })

  test("distinguishes staged and working diff tabs", () => {
    expect(getContextPanelTabLabel({ mode: "diff", label: null, targetPath: null, stagedDiff: true }, t)).toBe(
      "contextPanel.mode.stagedDiff",
    )
    expect(getContextPanelTabLabel({ mode: "diff", label: null, targetPath: null }, t)).toBe(
      "contextPanel.mode.workingDiff",
    )
  })

  test("falls back to the mode label for other modes", () => {
    expect(getContextPanelTabLabel({ mode: "plan", label: null, targetPath: null }, t)).toBe("contextPanel.mode.plan")
  })
})

describe("truncateContextPanelTabLabel", () => {
  test("keeps labels at or below the limit unchanged", () => {
    expect(truncateContextPanelTabLabel("short", CONTEXT_PANEL_TAB_LABEL_MAX_CHARS)).toBe("short")
    expect(truncateContextPanelTabLabel("x".repeat(CONTEXT_PANEL_TAB_LABEL_MAX_CHARS), CONTEXT_PANEL_TAB_LABEL_MAX_CHARS)).toBe(
      "x".repeat(CONTEXT_PANEL_TAB_LABEL_MAX_CHARS),
    )
  })

  test("truncates longer labels with an ellipsis suffix", () => {
    const value = "a".repeat(CONTEXT_PANEL_TAB_LABEL_MAX_CHARS + 5)
    const truncated = truncateContextPanelTabLabel(value, CONTEXT_PANEL_TAB_LABEL_MAX_CHARS)
    expect(truncated).toBe(`${"a".repeat(CONTEXT_PANEL_TAB_LABEL_MAX_CHARS - 3)}...`)
    expect(truncated).toHaveLength(CONTEXT_PANEL_TAB_LABEL_MAX_CHARS)
  })
})

describe("getContextPanelSessionIDFromDedupeKey", () => {
  test("returns null for missing or non-session keys", () => {
    expect(getContextPanelSessionIDFromDedupeKey(undefined)).toBeNull()
    expect(getContextPanelSessionIDFromDedupeKey("file:/repo/app.ts")).toBeNull()
  })

  test("extracts and trims the session id", () => {
    expect(getContextPanelSessionIDFromDedupeKey("session:abc123")).toBe("abc123")
    expect(getContextPanelSessionIDFromDedupeKey("session:  abc123  ")).toBe("abc123")
  })

  test("returns null when the session id is blank", () => {
    expect(getContextPanelSessionIDFromDedupeKey("session:")).toBeNull()
    expect(getContextPanelSessionIDFromDedupeKey("session:   ")).toBeNull()
  })
})
