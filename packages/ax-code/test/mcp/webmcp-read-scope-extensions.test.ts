import { describe, expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { WebMcpAutoApproval } from "../../src/mcp/webmcp-auto-approval"
import { webMcpApprovalLines } from "../../src/mcp/webmcp-approval"
import { convertMcpTool } from "../../src/mcp/tool-conversion"
import { WebMcpApprovals } from "../../src/mcp/webmcp-approvals"

// ADR-192: navigation types (reload/back/forward), console stack traces and
// get_console_message, generated limit notes, and the consequential-hint
// tightening of the full-access Auto admission (ADR-189 amendment).

const ORIGIN = "https://app.test"
const PAGE = `${ORIGIN}/orders`
const restricted = () => WebMcpProfile.config({ allowedOrigins: [ORIGIN], read: true }, true).webmcp
const unrestricted = () => WebMcpProfile.config({ allowedOrigins: [], read: true }, true).webmcp
const pagesOnly = () => WebMcpProfile.config({ allowedOrigins: [] }, true).webmcp

function navigated(message: string, url = PAGE, extraText?: string) {
  return {
    content: [{ type: "text", text: message }, ...(extraText ? [{ type: "text", text: extraText }] : [])],
    structuredContent: { message, pages: [{ id: 1, url, selected: true }] },
  }
}

describe("navigate_page types (ADR-192)", () => {
  test("reload is admitted on every profile; url stays the default and the only type that takes a url", () => {
    for (const profile of [restricted(), unrestricted()]) {
      expect(WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, type: "reload" })).toEqual({
        pageId: 1,
        type: "reload",
      })
      expect(
        WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, type: "reload", ignoreCache: true }),
      ).toEqual({ pageId: 1, type: "reload", ignoreCache: true })
      expect(WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, url: PAGE })).toEqual({
        pageId: 1,
        url: PAGE,
      })
      // url without a type is type url; type url without a url is incomplete.
      expect(() => WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1 })).toThrow("Invalid arguments")
      expect(() => WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, type: "url" })).toThrow()
      // A url rides only on type url; ignoreCache rides only on reload.
      expect(() =>
        WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, type: "reload", url: PAGE }),
      ).toThrow()
      expect(() =>
        WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, url: PAGE, ignoreCache: true }),
      ).toThrow()
      // Upstream extras the model must never reach.
      for (const extra of [{ initScript: "1" }, { handleBeforeUnload: "accept" }, { timeout: 1000 }]) {
        expect(() =>
          WebMcpProfile.validateCall(profile, "navigate_page", { pageId: 1, type: "reload", ...extra }),
        ).toThrow()
      }
    }
  })

  test("history navigation is refused on an origin-restricted bridge and admitted without a url elsewhere", () => {
    for (const type of WebMcpProfile.HISTORY_NAVIGATION_TYPES) {
      expect(() => WebMcpProfile.validateCall(restricted(), "navigate_page", { pageId: 1, type })).toThrow(
        "unavailable on an origin-restricted bridge",
      )
      expect(WebMcpProfile.validateCall(unrestricted(), "navigate_page", { pageId: 1, type })).toEqual({
        pageId: 1,
        type,
      })
      expect(() =>
        WebMcpProfile.validateCall(unrestricted(), "navigate_page", { pageId: 1, type, url: PAGE }),
      ).toThrow()
    }
    expect(WebMcpProfile.isHistoryNavigation({ type: "back" })).toBe(true)
    expect(WebMcpProfile.isHistoryNavigation({ type: "reload" })).toBe(false)
    expect(WebMcpProfile.navigationType({})).toBe("url")
    expect(WebMcpProfile.navigationType({ type: "forward" })).toBe("forward")
  })

  test("the success line must match the requested type and an appended Unable line is a failure", () => {
    const ok = (message: string, call: Record<string, unknown>) =>
      WebMcpProfile.validateResult("navigate_page", navigated(message), call)
    expect(() => ok("Successfully reloaded the page.", { pageId: 1, type: "reload" })).not.toThrow()
    expect(() => ok(`Successfully navigated back to ${PAGE}.`, { pageId: 1, type: "back" })).not.toThrow()
    expect(() => ok(`Successfully navigated forward to ${PAGE}.`, { pageId: 1, type: "forward" })).not.toThrow()
    expect(() => ok(`Successfully navigated to ${PAGE}.`, { pageId: 1, url: PAGE })).not.toThrow()
    // Without the call the legacy url expectation applies.
    expect(() =>
      WebMcpProfile.validateResult("navigate_page", navigated(`Successfully navigated to ${PAGE}.`)),
    ).not.toThrow()
    // A url-navigation line does not confirm the reload that was approved, and the reverse.
    expect(() => ok(`Successfully navigated to ${PAGE}.`, { pageId: 1, type: "reload" })).toThrow("did not confirm")
    expect(() => ok("Successfully reloaded the page.", { pageId: 1, url: PAGE })).toThrow("did not confirm")
    // The pinned bridge appends failures as text without isError.
    for (const unable of [
      "Unable to reload the selected page: net::ERR_CONNECTION_REFUSED.",
      "Unable to navigate back in the selected page: timeout.",
      "Unable to navigate in the selected page: Navigation timeout of 30000 ms exceeded.",
    ]) {
      expect(() =>
        WebMcpProfile.validateResult("navigate_page", navigated(`Successfully reloaded the page.\n${unable}`), {
          pageId: 1,
          type: "reload",
        }),
      ).toThrow("WebMCP navigation failed")
      expect(() =>
        WebMcpProfile.validateResult("navigate_page", navigated("Successfully reloaded the page.", PAGE, unable), {
          pageId: 1,
          type: "reload",
        }),
      ).toThrow("WebMCP navigation failed")
    }
    // The scan is unbounded: a failure line after kilobytes of page listing, in
    // a late content part, or in a wording the pinned build does not use today
    // still fails the call (Muse review of ADR-192).
    const padded = navigated(
      `Successfully reloaded the page.\n${"page list ".repeat(600)}\nUnable to go back: no history entry.`,
    )
    expect(() => WebMcpProfile.validateResult("navigate_page", padded, { pageId: 1, type: "reload" })).toThrow(
      "WebMCP navigation failed",
    )
    const late = navigated("Successfully reloaded the page.")
    for (let index = 0; index < 9; index++) late.content.push({ type: "text", text: `section ${index}` })
    late.content.push({ type: "text", text: "Unable to reload the selected page: detached." })
    expect(() => WebMcpProfile.validateResult("navigate_page", late, { pageId: 1, type: "reload" })).toThrow(
      "WebMCP navigation failed",
    )
    // An ordinary sentence that merely contains the words is not a failure line.
    expect(() =>
      WebMcpProfile.validateResult(
        "navigate_page",
        navigated("Successfully reloaded the page.", PAGE, "Page title: We were unable to find that order"),
        { pageId: 1, type: "reload" },
      ),
    ).not.toThrow()
    // The failure text never carries the page's own words.
    try {
      WebMcpProfile.validateResult("navigate_page", navigated("Unable to reload the selected page: secret-path-xyz."), {
        pageId: 1,
        type: "reload",
      })
    } catch (error) {
      expect(String(error)).not.toContain("secret-path-xyz")
    }
  })

  test("approval metadata marks reload and history moves; the prompt explains them", () => {
    const profile = unrestricted()
    const reload = WebMcpProfile.approvalMetadata("bridge", profile, "navigate_page", {
      pageId: 1,
      type: "reload",
      ignoreCache: true,
    })
    expect(reload).toMatchObject({ navigationType: "reload", ignoreCache: true })
    expect(reload).not.toHaveProperty("historyNavigation")
    const back = WebMcpProfile.approvalMetadata("bridge", profile, "navigate_page", { pageId: 1, type: "back" })
    expect(back).toMatchObject({ navigationType: "back", historyNavigation: true })
    const url = WebMcpProfile.approvalMetadata("bridge", profile, "navigate_page", { pageId: 1, url: PAGE })
    expect(url).not.toHaveProperty("navigationType")
    expect(url).toMatchObject({ origin: ORIGIN })

    const reloadLines = webMcpApprovalLines(reload).join("\n")
    expect(reloadLines).toContain("reload the current page (cache bypassed)")
    expect(reloadLines).toContain("Unsaved page state can be lost")
    const backLines = webMcpApprovalLines(back).join("\n")
    expect(backLines).toContain("back through this page's history")
    expect(backLines).toContain("destination is unknown until the page lands")
    expect(backLines).toContain("never saved and never runs without this prompt")
    expect(webMcpApprovalLines(url).join("\n")).not.toContain("history")
  })

  test("a reload clears the uid map and the listing baseline although the URL is unchanged", async () => {
    const profile = unrestricted()
    const calls: string[] = []
    const client = {
      callTool: vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
        calls.push(request.name)
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
        }
        if (request.name === "take_snapshot") {
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
        expect(request.name).toBe("navigate_page")
        expect(request.arguments).toEqual({ pageId: 1, type: "reload" })
        return navigated("Successfully reloaded the page.")
      }),
    }
    const policy = (toolName: string): WebMcpProfile.Policy => ({
      server: "bridge",
      toolName,
      profile,
      readGrants: () => new Set([ORIGIN]),
    })
    const options = () => ({ toolCallId: "call", messages: [] }) as never
    const snapshot = await convertMcpTool(
      { name: "take_snapshot", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("take_snapshot"),
    )
    await snapshot.execute!({ pageId: 1 }, options())
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")?.name).toBe("Save")
    const navigate = await convertMcpTool(
      { name: "navigate_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("navigate_page"),
    )
    await navigate.execute!({ pageId: 1, type: "reload" }, options())
    expect(calls).toContain("navigate_page")
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
  })

  test("a navigation that reached the bridge and failed afterwards still drops the uid map", async () => {
    const profile = unrestricted()
    const client = {
      callTool: vi.fn(async (request: { name: string }) => {
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
        }
        if (request.name === "take_snapshot") {
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
        // A reload that partly happened: success line plus an appended failure.
        return navigated("Successfully reloaded the page.\nUnable to reload the selected page: detached.")
      }),
    }
    const policy = (toolName: string): WebMcpProfile.Policy => ({
      server: "bridge",
      toolName,
      profile,
      readGrants: () => new Set([ORIGIN]),
    })
    const options = () => ({ toolCallId: "call", messages: [] }) as never
    const snapshot = await convertMcpTool(
      { name: "take_snapshot", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("take_snapshot"),
    )
    await snapshot.execute!({ pageId: 1 }, options())
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")?.name).toBe("Save")
    const navigate = await convertMcpTool(
      { name: "navigate_page", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      policy("navigate_page"),
    )
    await expect(navigate.execute!({ pageId: 1, type: "reload" }, options())).rejects.toThrow(
      "WebMCP navigation failed",
    )
    expect(WebMcpProfile.targetSummaryFor(profile, 1, "1_1")).toBeUndefined()
  })

  test("saved navigation approvals never capture a reload or history move (no url to bind)", async () => {
    const policy: WebMcpProfile.Policy = { server: "bridge", toolName: "navigate_page", profile: unrestricted() }
    for (const call of [
      { pageId: 1, type: "reload" },
      { pageId: 1, type: "back" },
      { pageId: 1, type: "forward" },
    ]) {
      expect(await WebMcpApprovals.captureCall(policy, call)).toBeUndefined()
    }
  })
})

describe("Auto admission (ADR-189 amendment)", () => {
  const admission = { permission: "webmcp", patterns: ["bridge"] }
  const valid = async () => true
  const bind = (toolName: string, profile: WebMcpProfile.Configuration, operation: Record<string, unknown>) => {
    const metadata: Record<string, unknown> = { server: "bridge", tool: toolName, ...operation }
    WebMcpAutoApproval.bindBridge(metadata, { server: "bridge", toolName, profile }, admission, valid)
    return WebMcpAutoApproval.get(metadata, "webmcp", ["bridge"])
  }

  test("history navigation never binds; reload and url navigation bind as page tools", () => {
    const profile = unrestricted()
    expect(bind("navigate_page", profile, { navigationType: "back", historyNavigation: true })).toBeUndefined()
    expect(bind("navigate_page", profile, { navigationType: "forward", historyNavigation: true })).toBeUndefined()
    expect(bind("navigate_page", profile, { navigationType: "reload" })?.tier).toBe("pages")
    expect(bind("navigate_page", profile, { origin: ORIGIN })?.tier).toBe("pages")
  })

  test("a page tool declared consequential keeps its prompt; missing or false annotations are unchanged", () => {
    const profile = pagesOnly()
    expect(
      bind("execute_webmcp_tool", profile, {
        toolName: "pay",
        annotations: { readOnly: false, untrustedContent: false, consequential: true },
      }),
    ).toBeUndefined()
    const relaxed = bind("execute_webmcp_tool", profile, {
      toolName: "search",
      annotations: { readOnly: false, untrustedContent: false, consequential: false },
    })
    expect(relaxed?.tier).toBe("invoke")
    expect(relaxed?.fullAccessOnly).toBe(true)
    expect(bind("execute_webmcp_tool", profile, { toolName: "search" })?.tier).toBe("invoke")
    // Only the normalised boolean counts: a page cannot smuggle a string flag either way.
    expect(bind("execute_webmcp_tool", profile, { toolName: "x", annotations: { consequential: "true" } })?.tier).toBe(
      "invoke",
    )
  })
})

describe("console stack traces and get_console_message (ADR-192)", () => {
  test("get_console_message is a read-scope tool with a strict msgid schema", () => {
    expect(WebMcpProfile.READ_SCOPE_TOOLS).toContain("get_console_message")
    expect(WebMcpProfile.allows("get_console_message")).toBe(false)
    expect(WebMcpProfile.allows("get_console_message", pagesOnly())).toBe(false)
    expect(WebMcpProfile.allows("get_console_message", unrestricted())).toBe(true)
    const profile = unrestricted()
    expect(WebMcpProfile.validateCall(profile, "get_console_message", { pageId: 1, msgid: 7 })).toEqual({
      pageId: 1,
      msgid: 7,
    })
    for (const bad of [{ pageId: 1 }, { pageId: 1, msgid: -1 }, { pageId: 1, msgid: 1.5 }, { pageId: 1, msgid: "7" }]) {
      expect(() => WebMcpProfile.validateCall(profile, "get_console_message", bad)).toThrow()
    }
    expect(() =>
      WebMcpProfile.validateCall(profile, "get_console_message", { pageId: 1, msgid: 7, filePath: "/x" }),
    ).toThrow()
    expect(
      WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, includeStackTraces: true }),
    ).toEqual({ pageId: 1, includeStackTraces: true })
    expect(WebMcpProfile.toolDescription("get_console_message", profile)).toContain("msgid")
  })

  test("console output redacts local paths and secret query keys and keeps the read budget", () => {
    const frames = [
      "Error: boom",
      "    at render (http://localhost:3000/src/App.tsx?token=abc123:12:5)",
      "    at file:///Users/dev/project/src/main.ts:3:1",
      "    at /home/dev/project/node_modules/react/index.js:1:1",
      "    at C:\\Users\\dev\\project\\src\\win.ts:9:9",
    ].join("\n")
    for (const name of ["get_console_message", "list_console_messages"]) {
      const result = { content: [{ type: "text", text: frames }] }
      WebMcpProfile.boundReadResult(name, result, ORIGIN)
      const text = result.content.map((part) => part.text).join("\n")
      expect(text).toContain(`[Untrusted web content from ${ORIGIN}]`)
      // The secret query key is redacted (its value runs to the next whitespace); the page URL itself stays.
      expect(text).toContain("http://localhost:3000/src/App.tsx?token=[redacted]")
      expect(text).not.toContain("abc123")
      expect(text).not.toContain("/Users/dev")
      expect(text).not.toContain("/home/dev")
      expect(text).not.toContain("C:\\Users\\dev")
      expect(text).toContain("file://[local path redacted]")
      expect(text).toContain("~/project/node_modules/react/index.js")
    }
    // A /home/ or /Users/ segment inside an http(s) URL is the page's route, not a local path (Grok review).
    const routes = {
      content: [
        { type: "text", text: "    at https://cdn.example/home/static/app.js:1:1 (https://site.example/Users/guide)" },
      ],
    }
    WebMcpProfile.boundReadResult("get_console_message", routes, ORIGIN)
    expect(routes.content.map((part) => part.text).join("\n")).toContain("https://cdn.example/home/static/app.js:1:1")
    expect(routes.content.map((part) => part.text).join("\n")).toContain("https://site.example/Users/guide")
    {
    }
    const big = { content: [{ type: "text", text: "x".repeat(32 * 1024 + 1) }] }
    expect(() => WebMcpProfile.boundReadResult("get_console_message", big, ORIGIN)).toThrow(
      "console message exceeded the 32 KiB read budget",
    )
  })

  test("get_console_message needs the read grant before the bridge is asked for the message", async () => {
    const profile = unrestricted()
    const calls: string[] = []
    const client = {
      callTool: vi.fn(async (request: { name: string }) => {
        calls.push(request.name)
        if (request.name === "list_pages") {
          return { content: [], structuredContent: { pages: [{ id: 1, url: PAGE, selected: true }] } }
        }
        return { content: [{ type: "text", text: "Error: boom\n    at file:///Users/dev/a.ts:1:1" }] }
      }),
    }
    const grants = new Set<string>()
    const tool = await convertMcpTool(
      { name: "get_console_message", inputSchema: { type: "object" } } as never,
      client as never,
      5000,
      { server: "bridge", toolName: "get_console_message", profile, readGrants: () => grants },
    )
    const options = () => ({ toolCallId: "call", messages: [] }) as never
    await expect(tool.execute!({ pageId: 1, msgid: 3 }, options())).rejects.toBeInstanceOf(
      WebMcpProfile.ReadNotGrantedError,
    )
    expect(calls).not.toContain("get_console_message")
    grants.add(ORIGIN)
    const result = (await tool.execute!({ pageId: 1, msgid: 3 }, options())) as { content: { text: string }[] }
    expect(calls).toContain("get_console_message")
    expect(result.content[0]?.text).toBe(`[Untrusted web content from ${ORIGIN}]`)
    expect(result.content.map((part) => part.text).join("\n")).not.toContain("/Users/dev")
  })
})

describe("generated limit notes (ADR-192)", () => {
  test("the read and interact notes name every admitted tool of their tier and nothing the bridge never admits", () => {
    for (const name of WebMcpProfile.READ_SCOPE_TOOLS) {
      expect(WebMcpProfile.READ_LIMITS_NOTE).toContain(name)
      expect(WebMcpProfile.INTERACT_LIMITS_NOTE).toContain(name)
    }
    for (const name of WebMcpProfile.INTERACT_TOOLS) expect(WebMcpProfile.INTERACT_LIMITS_NOTE).toContain(name)
    expect(WebMcpProfile.READ_LIMITS_NOTE).toContain(`${WebMcpProfile.READ_SCOPE_TOOLS.length} tools`)
    expect(WebMcpProfile.INTERACT_LIMITS_NOTE).toContain("click, hover, fill, fill_form take snapshot uids")
    expect(WebMcpProfile.INTERACT_LIMITS_NOTE).toContain("wait_for, press_key, handle_dialog do not accept uid")
    for (const never of ["click_at", "type_text", "resize_page", "get_css_styles", "lighthouse_audit"]) {
      expect(WebMcpProfile.READ_LIMITS_NOTE).not.toContain(never)
      expect(WebMcpProfile.INTERACT_LIMITS_NOTE).not.toContain(never)
    }
    // The grant prompt lists the same read set.
    const lines = webMcpApprovalLines({ server: "bridge", readGrant: true, origin: ORIGIN }).join("\n")
    expect(lines).toContain(`Read tools: ${WebMcpProfile.READ_SCOPE_TOOLS.join(", ")}`)
  })
})
