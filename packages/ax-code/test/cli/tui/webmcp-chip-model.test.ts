import { describe, expect, test } from "vitest"
import { webMcpChipModel } from "../../../src/cli/tui/component/webmcp-chip-model"

const configured = (names: string[]) => Object.fromEntries(names.map((name) => [name, { webmcp: {} }]))

describe("webMcpChipModel", () => {
  test("hidden without a webmcp-profiled server", () => {
    expect(webMcpChipModel({}, {}).servers).toEqual([])
    expect(webMcpChipModel({ plain: { type: "local" } }, {}).servers).toEqual([])
  })

  test("disconnected servers render an inactive toggle", () => {
    const model = webMcpChipModel(configured(["bridge"]), {})
    expect(model.servers).toEqual(["bridge"])
    expect(model.view).toBe("toggle")
    expect(model.label).toBe("WebMCP")
    expect(model.connected).toEqual([])
  })

  test("an all-denied fleet renders a lock that lists the denied servers", () => {
    const single = webMcpChipModel(configured(["a"]), { a: { status: "blocked" } })
    expect(single.view).toBe("lock")
    expect(single.lockText).toBe("🔒 WebMCP (a)")
    const multi = webMcpChipModel(configured(["a", "b"]), { a: { status: "blocked" }, b: { status: "blocked" } })
    expect(multi.view).toBe("lock")
    expect(multi.lockText).toBe("🔒 WebMCP (a, b)")
    const reasoned = webMcpChipModel(configured(["a"]), {
      a: { status: "blocked", error: "WebMCP bridge is disabled by managed policy" },
    })
    expect(reasoned.lockText).toBe("🔒 WebMCP (a): WebMCP bridge is disabled by managed policy")
  })

  test("a denial beside an actionable sibling stays an interactive toggle", () => {
    const model = webMcpChipModel(configured(["a", "b"]), { a: { status: "blocked" } })
    expect(model.view).toBe("toggle")
    expect(model.label).toBe("WebMCP (0/2) 🔒")
  })

  test("failures render a warning with fallbacks for auth states", () => {
    const failed = webMcpChipModel(configured(["a"]), { a: { status: "failed", error: "  boom\nx" } })
    expect(failed.view).toBe("warning")
    expect(failed.warningText).toBe("⚠ WebMCP: boom x")
    expect(failed.attentions).toEqual([{ name: "a", error: "boom x" }])
    const auth = webMcpChipModel(configured(["a"]), { a: { status: "needs_auth" } })
    expect(auth.warningText).toBe("⚠ WebMCP: needs authentication")
    const registration = webMcpChipModel(configured(["a"]), { a: { status: "needs_client_registration" } })
    expect(registration.warningText).toBe("⚠ WebMCP: needs client registration")
    const trust = webMcpChipModel(configured(["a"]), { a: { status: "needs_trust" } })
    expect(trust.warningText).toBe("⚠ WebMCP: server is not trusted")
  })

  test("a warning without an error names the bridge and keeps the lock marker", () => {
    const missing = webMcpChipModel(configured(["a"]), { a: { status: "failed" } })
    expect(missing.warningText).toBe("⚠ WebMCP: a")
    const blank = webMcpChipModel(configured(["a"]), { a: { status: "failed", error: "   " } })
    expect(blank.warningText).toBe("⚠ WebMCP: a")
    const object = webMcpChipModel(configured(["a"]), { a: { status: "failed", error: new Error("kaput") } })
    expect(object.warningText).toBe("⚠ WebMCP: kaput")
    const denied = webMcpChipModel(configured(["a", "b"]), {
      a: { status: "blocked" },
      b: { status: "failed", error: "boom" },
    })
    expect(denied.view).toBe("warning")
    expect(denied.warningText).toBe("⚠ WebMCP: boom 🔒")
  })

  test("long errors truncate with an ellipsis", () => {
    const model = webMcpChipModel(configured(["a"]), { a: { status: "failed", error: "e".repeat(200) } })
    expect(model.warningText).toBe(`⚠ WebMCP: ${"e".repeat(79)}…`)
  })

  test("several failures count the rest beyond the first", () => {
    const model = webMcpChipModel(configured(["a", "b", "c"]), {
      a: { status: "failed", error: "first" },
      b: { status: "needs_auth" },
      c: { status: "connected" },
    })
    expect(model.view).toBe("toggle")
    expect(model.label).toBe("WebMCP (1/3) ⚠")
    expect(model.attentions.map((attention) => attention.name)).toEqual(["a", "b"])
    const quiet = webMcpChipModel(configured(["a", "b"]), {
      a: { status: "failed", error: "first" },
      b: { status: "needs_auth" },
    })
    expect(quiet.view).toBe("warning")
    expect(quiet.warningText).toBe("⚠ WebMCP: a: first (+1 more)")
  })

  test("mixed states keep every marker on the active toggle", () => {
    const blocked = webMcpChipModel(configured(["a", "b"]), {
      a: { status: "connected" },
      b: { status: "blocked" },
    })
    expect(blocked.view).toBe("toggle")
    expect(blocked.label).toBe("WebMCP (1/2) 🔒")
    const failed = webMcpChipModel(configured(["a", "b"]), {
      a: { status: "connected" },
      b: { status: "failed", error: "boom" },
    })
    expect(failed.view).toBe("toggle")
    expect(failed.label).toBe("WebMCP (1/2) ⚠")
    const both = webMcpChipModel(configured(["a", "b", "c"]), {
      a: { status: "connected" },
      b: { status: "blocked" },
      c: { status: "failed", error: "boom" },
    })
    expect(both.label).toBe("WebMCP (1/3) 🔒 ⚠")
  })

  test("healthy connections render a plain active toggle", () => {
    const single = webMcpChipModel(configured(["a"]), { a: { status: "connected" } })
    expect(single.view).toBe("toggle")
    expect(single.label).toBe("WebMCP")
    const multi = webMcpChipModel(configured(["a", "b"]), { a: { status: "connected" }, b: { status: "connected" } })
    expect(multi.label).toBe("WebMCP (2/2)")
  })
})
