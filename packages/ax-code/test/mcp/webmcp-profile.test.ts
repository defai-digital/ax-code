import { describe, expect, test } from "vitest"
import { Config } from "../../src/config/config"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { McpTrust } from "../../src/mcp/trust"
import path from "node:path"

const origins = ["https://example.test", "http://127.0.0.1:3000"]

describe("WebMCP profile", () => {
  test("generates disabled, isolated, pinned and origin-restricted configuration", () => {
    const config = WebMcpProfile.config({ allowedOrigins: origins })
    expect(config.enabled).toBe(false)
    expect(config.command.slice(0, 3)).toEqual(["npx", "-y", "chrome-devtools-mcp@1.8.0"])
    expect(config.command).toEqual(
      expect.arrayContaining([
        "--isolated",
        "--no-usage-statistics",
        "--no-performance-crux",
        "--category-experimental-webmcp",
        "--experimental-structured-content",
        "--chrome-arg=--enable-features=WebMCP",
        "--allowed-url-pattern=https://example.test/*",
        "--allowed-url-pattern=http://127.0.0.1:3000/*",
      ]),
    )
    expect(config.environment).toBeUndefined()
    expect(Config.McpLocal.safeParse(config).success).toBe(true)
    expect(WebMcpProfile.disabled(config)).toBe(true)
    expect(WebMcpProfile.disabled({ ...config, enabled: undefined })).toBe(true)
    expect(WebMcpProfile.disabled({ ...config, enabled: true })).toBe(false)
    expect(WebMcpProfile.disabled({ type: "local", command: ["other"] })).toBe(false)
  })

  test("supports explicit headless and startup opt-in without changing the profile isolation", () => {
    const executablePath = path.resolve("chrome-for-testing")
    const config = WebMcpProfile.config({ allowedOrigins: origins, headless: true, executablePath }, true)
    expect(config.enabled).toBe(true)
    expect(config.command).toContain("--headless")
    expect(config.command).toContain(`--executable-path=${executablePath}`)
    expect(WebMcpProfile.validateLaunch(config)).toEqual(config.webmcp)
  })

  test.each(
    [
      [],
      ["*"],
      ["https://*.example.test"],
      ["https://exa+ple.test"],
      ["https://user:password@example.test"],
      ["https://example.test/path"],
      ["https://example.test?token=value"],
      ["https://example.test#fragment"],
      ["file:///tmp"],
      ["http://example.test"],
      ["http://localhost.example.test"],
      ["https://example.test\\evil"],
      ["https://example.test", "https://example.test"],
      Array.from({ length: 9 }, (_, i) => `https://site${i}.test`),
    ].map((allowedOrigins) => ({ allowedOrigins })),
  )("rejects unsafe origin list $allowedOrigins", ({ allowedOrigins }) => {
    expect(() => WebMcpProfile.config({ allowedOrigins })).toThrow()
  })

  test.each(["relative/chrome", "", path.resolve("chrome") + "\0"])(
    "rejects invalid executable path",
    (executablePath) => {
      expect(() => WebMcpProfile.config({ allowedOrigins: origins, executablePath })).toThrow()
    },
  )

  test("generated URL patterns do not allow other schemes, ports or hosts", () => {
    for (const origin of [...origins, "http://[::1]:3000"]) {
      const config = WebMcpProfile.config({ allowedOrigins: [origin] })
      const pattern = config.command.find((arg) => arg.startsWith("--allowed-url-pattern="))!
      const matcher = new URLPattern(pattern.slice("--allowed-url-pattern=".length))
      expect(matcher.test(`${origin}/nested/path?q=ok`)).toBe(true)
      expect(matcher.test("https://example.test.evil.test/path")).toBe(false)
      expect(matcher.test("https://example.test:444/path")).toBe(false)
      expect(matcher.test("http://example.test/path")).toBe(false)
    }
  })

  test("rejects modified launch commands and environment overlays", () => {
    const config = WebMcpProfile.config({ allowedOrigins: origins }, true)
    expect(() => WebMcpProfile.validateLaunch({ ...config, command: [...config.command, "--auto-connect"] })).toThrow()
    expect(() => WebMcpProfile.validateLaunch({ ...config, command: ["node", "unreviewed.js"] })).toThrow()
    expect(() => WebMcpProfile.validateLaunch({ ...config, environment: { PROXY: "https://proxy.test" } })).toThrow()
    expect(() =>
      WebMcpProfile.validateLaunch({ ...config, webmcp: { allowedOrigins: ["https://changed.test"] } }),
    ).toThrow()
  })

  test("origin and launch posture changes invalidate MCP trust", () => {
    const config = WebMcpProfile.config({ allowedOrigins: origins })
    const before = McpTrust.fingerprint("bridge", config)
    expect(
      McpTrust.fingerprint("bridge", { ...config, webmcp: { allowedOrigins: ["https://changed.test"] } }),
    ).not.toBe(before)
    expect(McpTrust.fingerprint("bridge", { ...config, webmcp: { ...config.webmcp, headless: true } })).not.toBe(before)
  })

  test("admits only the reviewed bridge tools", () => {
    expect(WebMcpProfile.TOOLS).toEqual([
      "list_pages",
      "new_page",
      "navigate_page",
      "close_page",
      "list_webmcp_tools",
      "execute_webmcp_tool",
    ])
    for (const name of [
      "evaluate_script",
      "click",
      "fill",
      "upload_file",
      "install_extension",
      "execute_3p_developer_tool",
    ]) {
      expect(WebMcpProfile.allows(name)).toBe(false)
    }
  })

  test("validates and copies bridge calls and never exposes raw invocation input in approval metadata", () => {
    const profile = WebMcpProfile.config({ allowedOrigins: origins }).webmcp
    const args = { pageId: 1, toolName: "search.products", input: '{"query":"private search"}' }
    const call = WebMcpProfile.validateCall(profile, "execute_webmcp_tool", args)
    expect(call).toEqual(args)
    expect(call).not.toBe(args)
    args.toolName = "other"
    expect(call.toolName).toBe("search.products")
    const metadata = WebMcpProfile.approvalMetadata("bridge", profile, "execute_webmcp_tool", call)
    expect(metadata).toMatchObject({
      server: "bridge",
      tool: "execute_webmcp_tool",
      pageId: 1,
      toolName: "search.products",
    })
    expect(JSON.stringify(metadata)).not.toContain("private search")
  })

  test.each([
    ["new_page", { url: "https://denied.test/" }],
    ["new_page", { url: "https://example.test.evil.test/" }],
    ["new_page", { url: "https://user:password@example.test/" }],
    ["navigate_page", { pageId: 1, type: "back" }],
    ["close_page", { pageId: -1 }],
    ["list_pages", { script: "dangerous" }],
    ["execute_webmcp_tool", { pageId: 1, toolName: "test", input: "[]" }],
    ["execute_webmcp_tool", { pageId: 1, toolName: "test", input: "null" }],
    ["execute_webmcp_tool", { pageId: 1, toolName: "test", input: "invalid" }],
    ["execute_webmcp_tool", { pageId: 1, toolName: "bad name" }],
    ["execute_webmcp_tool", { pageId: 1, toolName: "test", input: JSON.stringify({ value: "x".repeat(65_536) }) }],
    ["evaluate_script", { pageId: 1, function: "() => 1" }],
  ])("rejects unsafe call %s", (tool, args) => {
    expect(() => WebMcpProfile.validateCall({ allowedOrigins: origins }, tool, args)).toThrow()
  })

  test.each(["Canceled", "Error", "unknown", undefined])(
    "does not confuse MCP success with page-tool completion: %s",
    (status) => {
      const result = {
        content: [],
        structuredContent: { message: JSON.stringify({ status, errorText: "private page data" }) },
      }
      expect(() => WebMcpProfile.validateResult("execute_webmcp_tool", result)).toThrow("did not confirm completion")
      try {
        WebMcpProfile.validateResult("execute_webmcp_tool", result)
      } catch (error) {
        expect(String(error)).not.toContain("private page data")
      }
    },
  )

  test("requires confirmed execution and navigation, with bridge errors remaining failures", () => {
    expect(() =>
      WebMcpProfile.validateResult("execute_webmcp_tool", {
        content: [],
        structuredContent: { message: '{"status":"Completed","output":"fixture"}' },
      }),
    ).not.toThrow()
    expect(() => WebMcpProfile.validateResult("execute_webmcp_tool", { content: [] })).toThrow()
    expect(() => WebMcpProfile.validateResult("new_page", { content: [], isError: true })).toThrow()
    expect(() =>
      WebMcpProfile.validateResult("navigate_page", {
        structuredContent: { message: "Unable to navigate in the selected page" },
      }),
    ).toThrow()
    expect(() =>
      WebMcpProfile.validateResult("navigate_page", {
        structuredContent: { message: "Successfully navigated to https://example.test/" },
      }),
    ).not.toThrow()
  })
})
