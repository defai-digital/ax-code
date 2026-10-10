import { describe, expect, test } from "vitest"
import type { WebMcpApprovalRecord } from "@ax-code/sdk/v2"
import {
  WEBMCP_ALLOWLIST_ADD,
  WEBMCP_ALLOWLIST_ORIGIN_HINT,
  WEBMCP_ALLOWLIST_SAVED,
  webMcpAllowlistActionKey,
  webMcpAllowlistDialogOptions,
  webMcpAllowlistGrantOptions,
  webMcpAllowlistOrigin,
  webMcpAllowlistRows,
} from "../../../src/cli/tui/component/webmcp-allowlist-dialog-model"

let counter = 0
function record(scope: WebMcpApprovalRecord["scope"]): WebMcpApprovalRecord {
  counter += 1
  return {
    server: "bridge",
    project: "test",
    scope,
    id: counter.toString(16).padStart(64, "0"),
    fingerprint: "f".repeat(64),
    revision: "00000000-0000-4000-8000-000000000000",
    policyVersion: 1,
    createdAt: counter,
  }
}

const saved = [
  record({ capability: "read", origin: "https://b.test" }),
  record({ capability: "navigate", origin: "https://a.test" }),
  record({ capability: "list_pages" }),
  record({ capability: "close", origin: "https://a.test" }),
]

const titles = (options: { title: string }[]) => options.map((option) => option.title)
const kinds = (options: { value: { kind: string } }[]) => options.map((option) => option.value.kind)

describe("webMcpAllowlistOrigin", () => {
  test("mirrors the server scope rule: https or loopback http, exact origin, no credentials or wildcards", () => {
    expect(webMcpAllowlistOrigin("https://example.test/path?q=1")).toBe("https://example.test")
    expect(webMcpAllowlistOrigin("  https://example.test:8443  ")).toBe("https://example.test:8443")
    expect(webMcpAllowlistOrigin("http://localhost:3000/app")).toBe("http://localhost:3000")
    expect(webMcpAllowlistOrigin("http://127.0.0.1")).toBe("http://127.0.0.1")
    for (const value of [
      "",
      "   ",
      "example.test",
      "http://example.test",
      "https://*.example.test",
      "https://user:pass@example.test",
      "ftp://example.test",
      "not a url",
    ]) {
      expect(webMcpAllowlistOrigin(value)).toBeUndefined()
    }
  })
})

describe("webMcpAllowlistRows", () => {
  test("orders page listing first, then by capability and origin", () => {
    expect(webMcpAllowlistRows(saved).map((row) => row.scope)).toEqual([
      { capability: "list_pages" },
      { capability: "navigate", origin: "https://a.test" },
      { capability: "read", origin: "https://b.test" },
      { capability: "close", origin: "https://a.test" },
    ])
  })
})

describe("webMcpAllowlistGrantOptions", () => {
  test("offers page listing until it is saved and nothing else for an empty query", () => {
    expect(titles(webMcpAllowlistGrantOptions([], ""))).toEqual(["Allow listing all browser pages"])
    expect(webMcpAllowlistGrantOptions(saved, "")).toEqual([])
  })

  test("offers one row per unsaved origin capability for a grantable query", () => {
    const options = webMcpAllowlistGrantOptions(saved, "https://a.test/anything")
    expect(titles(options)).toEqual(["Allow reads on https://a.test"])
    expect(options[0]?.value).toEqual({ kind: "grant", scope: { capability: "read", origin: "https://a.test" } })
    expect(options.every((option) => option.category === WEBMCP_ALLOWLIST_ADD)).toBe(true)
    expect(titles(webMcpAllowlistGrantOptions(saved, "https://new.test"))).toEqual([
      "Allow navigation to https://new.test",
      "Allow reads on https://new.test",
      "Allow closing pages on https://new.test",
    ])
  })

  test("a query that is not an origin offers nothing beyond a matching listing row", () => {
    expect(webMcpAllowlistGrantOptions([], "example")).toEqual([])
    expect(titles(webMcpAllowlistGrantOptions([], "listing"))).toEqual(["Allow listing all browser pages"])
  })
})

describe("webMcpAllowlistDialogOptions", () => {
  test("a failed load offers only a retry row", () => {
    const options = webMcpAllowlistDialogOptions({ records: undefined, query: "", loading: false, failed: true })
    expect(kinds(options)).toEqual(["retry"])
  })

  test("an empty store shows a disabled placeholder plus the listing grant", () => {
    const loading = webMcpAllowlistDialogOptions({ records: undefined, query: "", loading: true, failed: false })
    expect(titles(loading)).toEqual(["Loading approvals...", "Allow listing all browser pages"])
    expect(loading[0]?.disabled).toBe(true)
    const empty = webMcpAllowlistDialogOptions({ records: [], query: "", loading: false, failed: false })
    expect(titles(empty)[0]).toBe("No saved approvals")
    expect(empty[0]?.category).toBe(WEBMCP_ALLOWLIST_SAVED)
  })

  test("saved rows revoke, the clear row follows them, and nothing is offered twice", () => {
    const options = webMcpAllowlistDialogOptions({ records: saved, query: "", loading: false, failed: false })
    expect(titles(options)).toEqual([
      "List all browser pages",
      "navigate: https://a.test",
      "read: https://b.test",
      "close: https://a.test",
      "Revoke all saved approvals for this bridge",
    ])
    expect(kinds(options)).toEqual(["revoke", "revoke", "revoke", "revoke", "clear"])
    expect(options[1]?.value).toEqual({ kind: "revoke", id: saved[1]!.id })
    expect(options.slice(0, 4).every((option) => option.description === "double click to revoke")).toBe(true)
    expect(options[4]?.description).toBe("double click to revoke all")
  })

  test("only the armed destructive row asks for its second activation", () => {
    const revoke = webMcpAllowlistActionKey({ kind: "revoke", id: saved[1]!.id })
    expect(revoke).toBe(`revoke:${saved[1]!.id}`)
    expect(webMcpAllowlistActionKey({ kind: "clear" })).toBe("clear")
    expect(webMcpAllowlistActionKey({ kind: "grant", scope: { capability: "list_pages" } })).toBeUndefined()
    expect(webMcpAllowlistActionKey({ kind: "retry" })).toBeUndefined()
    const armedRow = webMcpAllowlistDialogOptions({
      records: saved,
      query: "",
      loading: false,
      failed: false,
      armed: revoke,
    })
    expect(armedRow.map((option) => option.description)).toEqual([
      "double click to revoke",
      "click again to revoke",
      "double click to revoke",
      "double click to revoke",
      "double click to revoke all",
    ])
    const armedClear = webMcpAllowlistDialogOptions({
      records: saved,
      query: "",
      loading: false,
      failed: false,
      armed: "clear",
    })
    expect(armedClear[4]?.description).toBe("click again to revoke all")
    expect(armedClear.slice(0, 4).every((option) => option.description === "double click to revoke")).toBe(true)
  })

  test("a query narrows saved rows, hides the clear row and appends grant rows for its origin", () => {
    const options = webMcpAllowlistDialogOptions({
      records: saved,
      query: "https://a.test",
      loading: false,
      failed: false,
    })
    expect(titles(options)).toEqual([
      "navigate: https://a.test",
      "close: https://a.test",
      "Allow reads on https://a.test",
    ])
    expect(kinds(options)).toEqual(["revoke", "revoke", "grant"])
  })

  test("a query that matches nothing and is not an origin explains the accepted shape", () => {
    const options = webMcpAllowlistDialogOptions({
      records: saved,
      query: "example.test",
      loading: false,
      failed: false,
    })
    expect(titles(options)).toEqual([WEBMCP_ALLOWLIST_ORIGIN_HINT])
    expect(options[0]?.disabled).toBe(true)
    expect(options[0]?.value).toEqual({ kind: "none" })
  })

  test("a query carrying a path or port still shows the saved rows of its origin", () => {
    const options = webMcpAllowlistDialogOptions({
      records: saved,
      query: "https://a.test/some/page?q=1",
      loading: false,
      failed: false,
    })
    expect(titles(options)).toEqual([
      "navigate: https://a.test",
      "close: https://a.test",
      "Allow reads on https://a.test",
    ])
    expect(kinds(options)).toEqual(["revoke", "revoke", "grant"])
  })
})
