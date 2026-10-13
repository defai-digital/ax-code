import { describe, expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { convertMcpTool } from "../../src/mcp/tool-conversion"

// ADR-193: resize_page viewport presets. ADR-194: headers-only get_network_request.

const ORIGIN = "https://app.test"
const PAGE = `${ORIGIN}/orders`
const pagesOnly = () => WebMcpProfile.config({ allowedOrigins: [] }, true).webmcp
const readOn = () => WebMcpProfile.config({ allowedOrigins: [], read: true }, true).webmcp
const interactOn = () => WebMcpProfile.config({ allowedOrigins: [], interact: true }, true).webmcp
const full = () => WebMcpProfile.config({ allowedOrigins: [], read: true, interact: true }, true).webmcp

const NEVER = ["emulate", "click_at", "type_text"] as const

describe("resize_page and get_network_request admission (ADR-193, ADR-194)", () => {
  test("allows admits both tools only with read: true; emulate and coordinate tools stay out", () => {
    for (const name of ["resize_page", "get_network_request"] as const) {
      expect(WebMcpProfile.READ_SCOPE_TOOLS).toContain(name)
      expect(WebMcpProfile.allows(name)).toBe(false)
      expect(WebMcpProfile.allows(name, pagesOnly())).toBe(false)
      expect(WebMcpProfile.allows(name, interactOn())).toBe(false)
      expect(WebMcpProfile.allows(name, readOn())).toBe(true)
      expect(WebMcpProfile.allows(name, full())).toBe(true)
    }
    for (const name of NEVER) {
      expect(WebMcpProfile.TOOLS).not.toContain(name)
      expect(WebMcpProfile.READ_SCOPE_TOOLS).not.toContain(name)
      expect(WebMcpProfile.INTERACT_TOOLS).not.toContain(name)
      for (const profile of [undefined, pagesOnly(), readOn(), interactOn(), full()]) {
        expect(WebMcpProfile.allows(name, profile)).toBe(false)
      }
    }
    expect(() => WebMcpProfile.callSchema("emulate", readOn())).toThrow("not admitted")
    expect(() => WebMcpProfile.callSchema("emulate", full())).toThrow("not admitted")
  })

  test("argv drops the emulation category flag, redacts network headers, and keeps performance blocked", () => {
    const command = WebMcpProfile.config({ allowedOrigins: [] }).command
    expect(command).not.toContain("--no-category-emulation")
    expect(command).toContain("--redactNetworkHeaders")
    expect(command).toContain("--no-category-performance")
    const drifted = [...command.filter((arg) => arg !== "--redactNetworkHeaders"), "--no-category-emulation"]
    const mismatch = WebMcpProfile.argvMismatch({
      type: "local",
      command: drifted,
      webmcp: { allowedOrigins: [] },
    } as never)
    expect(mismatch).toContain("extra --no-category-emulation")
  })
})

describe("resize_page schema (ADR-193)", () => {
  test("each viewport preset is accepted; other sizes and extra keys are rejected", () => {
    const profile = readOn()
    for (const [width, height] of WebMcpProfile.VIEWPORT_PRESETS) {
      expect(WebMcpProfile.validateCall(profile, "resize_page", { pageId: 1, width, height })).toEqual({
        pageId: 1,
        width,
        height,
      })
    }
    for (const bad of [
      { pageId: 1, width: 1000, height: 1000 },
      { pageId: 1, width: 375, height: 813 },
      { pageId: 1, width: 375.5, height: 812 },
      { pageId: 1, width: 375 },
      { pageId: 1, width: 375, height: 812, extra: true },
    ]) {
      expect(() => WebMcpProfile.validateCall(profile, "resize_page", bad)).toThrow("Invalid arguments")
    }
  })
})

describe("get_network_request schema (ADR-194)", () => {
  test("reqid is required and file-path keys are refused", () => {
    const profile = readOn()
    expect(WebMcpProfile.validateCall(profile, "get_network_request", { pageId: 1, reqid: 4 })).toEqual({
      pageId: 1,
      reqid: 4,
    })
    for (const bad of [
      { pageId: 1 },
      { pageId: 1, reqid: -1 },
      { pageId: 1, reqid: 1.5 },
      { pageId: 1, reqid: "4" },
      { pageId: 1, reqid: 4, requestFilePath: "/tmp/req" },
      { pageId: 1, reqid: 4, responseFilePath: "/tmp/res" },
    ]) {
      expect(() => WebMcpProfile.validateCall(profile, "get_network_request", bad)).toThrow("Invalid arguments")
    }
  })
})

describe("get_network_request boundReadResult (ADR-194)", () => {
  const fixture = [
    "## Request https://api.test/orders?token=abc&page=2",
    "Status: 403",
    "### Request Headers",
    "- accept:application/json",
    "- cookie:session=secret1",
    "- authorization:Bearer secret2",
    "### Response Headers",
    "- content-type:application/json",
    "- set-cookie:sid=secret3",
    "- access-control-allow-origin:*",
    "### Response Body",
    '{"error":"denied"}',
    "### Redirect chain",
    "- https://api.test/login",
  ].join("\n")

  test("omits bodies, redacts sensitive headers and secret query keys, and strips structured bodies", () => {
    const result = {
      content: [{ type: "text", text: fixture }],
      structuredContent: {
        networkRequest: {
          requestHeaders: { cookie: "x", accept: "a" },
          requestBody: "b",
          responseBody: "c",
          responseBodyFilePath: "/tmp/x",
          redirectChain: [{ url: "u" }],
        },
      },
    }
    WebMcpProfile.boundReadResult("get_network_request", result, ORIGIN)
    expect(result.content[0]?.text).toBe(`[Untrusted web content from ${ORIGIN}]`)
    const text = result.content.map((part) => part.text).join("\n")
    expect(text).not.toContain("secret1")
    expect(text).not.toContain("secret2")
    expect(text).not.toContain("secret3")
    expect(text).not.toContain("denied")
    expect(text).toContain("cookie:[redacted]")
    expect(text).toContain("authorization:[redacted]")
    expect(text).toContain("set-cookie:[redacted]")
    expect(text).toContain("access-control-allow-origin:*")
    expect(text).toContain("content-type")
    expect(text).toContain("Status: 403")
    expect(text).toContain("token=[redacted]")
    expect(text).toContain("page=2")
    expect(text.match(/\[omitted:/g)).toHaveLength(1)
    const request = result.structuredContent.networkRequest
    expect(request).not.toHaveProperty("requestBody")
    expect(request).not.toHaveProperty("responseBody")
    expect(request).not.toHaveProperty("responseBodyFilePath")
    expect(request.requestHeaders).toEqual({ cookie: "[redacted]", accept: "a" })
    expect(request.redirectChain).toEqual([{ url: "u" }])
  })

  test("a body is omitted through the end of the text because no heading inside it can be trusted", () => {
    const hostile = [
      "## Request https://api.test/login",
      "Status: 200",
      "### Request Headers",
      "- accept:text/markdown",
      "### Request Body",
      '{"password":"hunter2"}',
      "### Response Headers",
      "- set-cookie2:sid=secret4",
      "### Response Body",
      "# Report",
      "### Redirect chain",
      "secret-total-9000",
      "## Request https://evil.test/injected",
      "still-body",
    ].join("\n")
    const result = { content: [{ type: "text", text: hostile }] }
    WebMcpProfile.boundReadResult("get_network_request", result, ORIGIN)
    const text = result.content.map((part) => part.text).join("\n")
    for (const leaked of ["hunter2", "secret4", "secret-total-9000", "still-body", "evil.test", "### Redirect chain"]) {
      expect(text).not.toContain(leaked)
    }
    expect(text).toContain("- accept:text/markdown")
    expect(text.match(/\[omitted:/g)).toHaveLength(1)
  })

  test("local file paths never reach the model through request detail text or structured keys", () => {
    const result = {
      content: [
        {
          type: "text",
          text: [
            "## Request https://api.test/download",
            "Status: 200",
            "### Response Headers",
            '- content-disposition:attachment; filename="/Users/alice/Q3 plan.docx"',
            "### Redirect chain",
            "file:///home/alice/cache/report.pdf",
          ].join("\n"),
        },
      ],
      structuredContent: {
        request: { requestBodyFilePath: "/tmp/req", responseBodyFilePath: "/tmp/res", status: 200 },
      },
    }
    WebMcpProfile.boundReadResult("get_network_request", result, ORIGIN)
    const text = result.content.map((part) => part.text).join("\n")
    expect(text).not.toContain("/Users/alice")
    expect(text).not.toContain("/home/alice")
    expect(text).toContain("file://[local path redacted]")
    expect(result.structuredContent.request).toEqual({ status: 200 })
  })

  test("credential header variants are redacted while CORS and 401 headers stay readable", () => {
    for (const name of [
      "Set-Cookie2",
      "Cookie2",
      "X-Session-Token",
      "Refresh-Token",
      "X-Api-Key",
      "x-amz-security-token",
    ]) {
      expect(WebMcpProfile.sensitiveHeader(name)).toBe(true)
    }
    for (const name of [
      "access-control-allow-credentials",
      "access-control-allow-origin",
      "www-authenticate",
      "cache-control",
      "content-type",
      "location",
      "etag",
    ]) {
      expect(WebMcpProfile.sensitiveHeader(name)).toBe(false)
    }
    const result = {
      content: [{ type: "text", text: "- Cookie2:a=1\n- access-control-allow-credentials:true" }],
      structuredContent: { responseHeaders: { "Refresh-Token": "r", etag: "e" } },
    }
    WebMcpProfile.boundReadResult("get_network_request", result, ORIGIN)
    const text = result.content.map((part) => part.text).join("\n")
    expect(text).toContain("Cookie2:[redacted]")
    expect(text).toContain("access-control-allow-credentials:true")
    expect(result.structuredContent.responseHeaders).toEqual({ "Refresh-Token": "[redacted]", etag: "e" })
  })

  test("a structured payload deeper or larger than the inspection caps is dropped, not passed through", () => {
    let deep: Record<string, unknown> = { responseBody: "SECRET-DEEP" }
    for (let level = 0; level < 9; level++) deep = { child: deep }
    const nested = { content: [{ type: "text", text: "Status: 200" }], structuredContent: deep } as Record<
      string,
      unknown
    >
    WebMcpProfile.boundReadResult("get_network_request", nested, ORIGIN)
    expect(nested).not.toHaveProperty("structuredContent")
    const wide = {
      content: [{ type: "text", text: "Status: 200" }],
      structuredContent: { items: Array.from({ length: 2100 }, () => ({ responseBody: "SECRET-WIDE" })) },
    } as Record<string, unknown>
    WebMcpProfile.boundReadResult("get_network_request", wide, ORIGIN)
    expect(wide).not.toHaveProperty("structuredContent")
    const shallow = {
      content: [{ type: "text", text: "Status: 200" }],
      structuredContent: { a: { responseBody: "x", ok: 1 } },
    }
    WebMcpProfile.boundReadResult("get_network_request", shallow, ORIGIN)
    expect(shallow.structuredContent).toEqual({ a: { ok: 1 } })
  })

  test("text over 32 KiB rejects with network request exceeded", () => {
    const big = { content: [{ type: "text", text: "x".repeat(32 * 1024 + 1) }] }
    expect(() => WebMcpProfile.boundReadResult("get_network_request", big, ORIGIN)).toThrow("network request exceeded")
  })
})

describe("resize_page and get_network_request dispatch", () => {
  const options = () => ({ toolCallId: "call", messages: [] }) as never

  function snapshotResult() {
    return {
      content: [{ type: "text", text: "snapshot" }],
      structuredContent: {
        snapshot: {
          id: "1_0",
          role: "RootWebArea",
          name: "App",
          children: [{ id: "1_1", role: "button", name: "Save" }],
        },
      },
    }
  }

  test("resize_page under the read grant reaches the bridge and clears snapshot uids", async () => {
    const profile = readOn()
    const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = []
    const client = {
      callTool: vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
        calls.push(request)
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
        }
        if (request.name === "take_snapshot") return snapshotResult()
        expect(request.name).toBe("resize_page")
        expect(request.arguments).toEqual({ pageId: 1, width: 1280, height: 800 })
        return { content: [{ type: "text", text: "Resized" }], structuredContent: {} }
      }),
    }
    const policy = (toolName: string): WebMcpProfile.Policy => ({
      server: "bridge",
      toolName,
      profile,
      readGrants: () => new Set([ORIGIN]),
    })
    const snapshot = await convertMcpTool(
      { name: "take_snapshot", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("take_snapshot"),
    )
    await snapshot.execute!({ pageId: 1 }, options())
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")?.name).toBe("Save")
    const resize = await convertMcpTool(
      { name: "resize_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("resize_page"),
    )
    await resize.execute!({ pageId: 1, width: 1280, height: 800 }, options())
    expect(calls.some((call) => call.name === "resize_page")).toBe(true)
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
  })

  test("a resize during which the page left its origin still drops the uid map (Muse review)", async () => {
    const profile = readOn()
    let url = PAGE
    const client = {
      callTool: vi.fn(async (request: { name: string }) => {
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url, selected: true }] } }
        }
        if (request.name === "take_snapshot") return snapshotResult()
        url = "https://other.test/landing"
        return { content: [{ type: "text", text: "Resized" }], structuredContent: {} }
      }),
    }
    const policy = (toolName: string): WebMcpProfile.Policy => ({
      server: "bridge",
      toolName,
      profile,
      readGrants: () => new Set([ORIGIN]),
    })
    const snapshot = await convertMcpTool(
      { name: "take_snapshot", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("take_snapshot"),
    )
    await snapshot.execute!({ pageId: 1 }, options())
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")?.name).toBe("Save")
    const resize = await convertMcpTool(
      { name: "resize_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("resize_page"),
    )
    await expect(resize.execute!({ pageId: 1, width: 375, height: 812 }, options())).rejects.toThrow("navigated")
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
  })

  test("resize_page without the read grant never reaches the bridge", async () => {
    const profile = readOn()
    const names: string[] = []
    const client = {
      callTool: vi.fn(async (request: { name: string }) => {
        names.push(request.name)
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
        }
        return { content: [{ type: "text", text: "unexpected" }] }
      }),
    }
    const tool = await convertMcpTool(
      { name: "resize_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      { server: "bridge", toolName: "resize_page", profile, readGrants: () => new Set() },
    )
    await expect(tool.execute!({ pageId: 1, width: 1280, height: 800 }, options())).rejects.toBeInstanceOf(
      WebMcpProfile.ReadNotGrantedError,
    )
    expect(names).not.toContain("resize_page")
  })

  test("a non-preset viewport is rejected before any bridge call", async () => {
    const names: string[] = []
    const client = {
      callTool: vi.fn(async (request: { name: string }) => {
        names.push(request.name)
        return { content: [] }
      }),
    }
    const tool = await convertMcpTool(
      { name: "resize_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      { server: "bridge", toolName: "resize_page", profile: readOn(), readGrants: () => new Set([ORIGIN]) },
    )
    await expect(tool.execute!({ pageId: 1, width: 1000, height: 1000 }, options())).rejects.toThrow(
      "Invalid arguments",
    )
    expect(names).toEqual([])
  })

  test("get_network_request without the grant never reaches the bridge", async () => {
    const names: string[] = []
    const client = {
      callTool: vi.fn(async (request: { name: string }) => {
        names.push(request.name)
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
        }
        return { content: [{ type: "text", text: "unexpected" }] }
      }),
    }
    const tool = await convertMcpTool(
      { name: "get_network_request", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      { server: "bridge", toolName: "get_network_request", profile: readOn(), readGrants: () => new Set() },
    )
    await expect(tool.execute!({ pageId: 1, reqid: 4 }, options())).rejects.toBeInstanceOf(
      WebMcpProfile.ReadNotGrantedError,
    )
    expect(names).not.toContain("get_network_request")
  })
})
