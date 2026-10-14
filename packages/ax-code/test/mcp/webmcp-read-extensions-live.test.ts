import { expect, test, vi } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import { execFileSync } from "node:child_process"
import { CallToolResultSchema } from "@modelcontextprotocol/core"
import { MCP } from "../../src/mcp"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Opt-in only (AX_TEST_WEBMCP_CHROME): qualifies the ADR-192/193/194/195 read
// extensions against a real isolated headless Chrome and the pinned bridge:
// reload, console stack traces and get_console_message, viewport presets and
// get_css_styles; get_network_request (ADR-194) stays withdrawn.
const executablePath = process.env.AX_TEST_WEBMCP_CHROME
vi.stubEnv("AX_CODE_AUTONOMOUS", "0")

const PAGE = `<!doctype html><title>Read extensions</title>
<style>h1 { margin-left: 13px; color: rgb(1, 2, 3) }</style>
<h1>READ_EXTENSIONS_OK</h1><div id="box" role="note" aria-label="Styled box">box</div>
<button onclick="fetch('/api?token=abc123&page=2', { method: 'POST', body: JSON.stringify({ card: '4111111111111111' }) })">Load</button>
<script>
  function failDeep() { throw new Error("AX_STACK_MARKER") }
  setTimeout(() => { try { failDeep() } catch (error) { console.error(error) } }, 0)
  fetch("/api?token=abc123&page=2", { method: "POST", body: JSON.stringify({ card: "4111111111111111" }) })
</script>`

test.skipIf(!executablePath)(
  "real browser: reload, stack traces, viewport presets and CSS styles stay bounded",
  { timeout: 120_000, retry: 0 },
  async () => {
    await using server = createServer((request, response) => {
      if (request.url?.startsWith("/api")) {
        response.setHeader("Content-Type", "application/json")
        response.setHeader("Set-Cookie", "sid=SECRET_COOKIE_VALUE; HttpOnly")
        response.setHeader("Access-Control-Allow-Origin", "*")
        response.setHeader("Cache-Control", "no-store")
        response.end(JSON.stringify({ secret: "SECRET_RESPONSE_BODY" }))
        return
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(PAGE)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    const origin = `http://127.0.0.1:${address.port}`
    const entry = {
      ...WebMcpProfile.config({ allowedOrigins: [], headless: true, executablePath, read: true }, false),
      timeout: 60_000,
    }
    await using tmp = await tmpdir({ git: true, config: { mcp: { live: entry } } as never })
    console.info(
      `WebMCP read-extension qualification: ${WebMcpProfile.PACKAGE}; ${execFileSync(executablePath!, ["--version"], { encoding: "utf8" }).trim()}`,
    )
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          try {
            await MCP.connect("live")
            expect((await MCP.status()).live).toMatchObject({ status: "connected" })
            expect((await MCP.grantWebMcpReadOrigin("live", origin)).ok).toBe(true)
            const tools = await MCP.tools()
            for (const name of WebMcpProfile.READ_SCOPE_TOOLS) expect(tools[`live_${name}`], name).toBeDefined()
            expect(tools.live_evaluate_script).toBeUndefined()
            const run = async (name: string, args: Record<string, unknown>) => {
              const result = await tools[`live_${name}`].execute!(args, { toolCallId: `live_${name}`, messages: [] })
              return CallToolResultSchema.parse(result)
                .content.flatMap((item) => (item.type === "text" ? [item.text] : []))
                .join("\n")
            }
            await run("new_page", { url: `${origin}/fixture` })
            const pages = await run("list_pages", {})
            const line = pages.split("\n").find((entry) => entry.includes(`${origin}/fixture`))
            const pageId = Number(/^(\d+):/.exec(line ?? "")?.[1])
            expect(Number.isSafeInteger(pageId), pages).toBe(true)

            // ADR-192: reload confirms with its own success line.
            expect(await run("navigate_page", { pageId, type: "reload", ignoreCache: true })).toContain(
              "Successfully reloaded the page.",
            )
            await expect
              .poll(async () => run("take_snapshot", { pageId }), { timeout: 10_000 })
              .toContain("READ_EXTENSIONS_OK")

            // ADR-192: stack traces and one message by msgid.
            const consoleText = await expect
              .poll(async () => run("list_console_messages", { pageId, includeStackTraces: true }), { timeout: 10_000 })
              .toContain("AX_STACK_MARKER")
            void consoleText
            const listed = await run("list_console_messages", { pageId, includeStackTraces: true })
            const msgid = Number(/msgid=(\d+)/.exec(listed)?.[1])
            expect(Number.isSafeInteger(msgid), listed).toBe(true)
            const message = await run("get_console_message", { pageId, msgid })
            expect(message).toContain("AX_STACK_MARKER")
            expect(message).toContain("failDeep")

            // ADR-194 is withdrawn: the pinned bridge stalls on a no-store response
            // and then every later call times out, so the tool is not exposed.
            // Request metadata still lists the fetch, with the secret query value redacted.
            expect(tools.live_get_network_request).toBeUndefined()
            await expect
              .poll(async () => run("list_network_requests", { pageId, resourceTypes: ["fetch"] }), { timeout: 10_000 })
              .toContain("/api")
            expect(await run("list_network_requests", { pageId, resourceTypes: ["fetch"] })).not.toContain("abc123")

            // ADR-193/195: four emulated viewport presets, nothing else from emulate.
            // Each preset really changes the viewport: the PNG width of a viewport
            // capture equals the preset width (headless DPR 1, under the 1600 cap).
            const screenshotWidth = async () => {
              const result = await tools.live_take_screenshot.execute!(
                { pageId, format: "png" },
                { toolCallId: "live_take_screenshot", messages: [] },
              )
              const image = CallToolResultSchema.parse(result).content.find((item) => item.type === "image")
              expect(image, JSON.stringify(result).slice(0, 300)).toBeDefined()
              return Buffer.from((image as { data: string }).data, "base64").readUInt32BE(16)
            }
            for (const [index, viewport] of WebMcpProfile.VIEWPORT_EMULATIONS.entries()) {
              await run("emulate", { pageId, viewport })
              expect(await screenshotWidth(), viewport).toBe(WebMcpProfile.VIEWPORT_PRESETS[index]![0])
            }
            await expect(run("emulate", { pageId, viewport: "1000x1000x1" })).rejects.toThrow("Invalid arguments")
            await expect(run("emulate", { pageId, viewport: "1280x800x1", userAgent: "x" })).rejects.toThrow(
              "Invalid arguments",
            )
            expect(tools.live_resize_page).toBeUndefined()

            // ADR-195: one element's cascade by snapshot uid.
            const snapshot = await run("take_snapshot", { pageId })
            const uid = /uid=(\S+) heading "READ_EXTENSIONS_OK"/.exec(snapshot)?.[1]
            expect(uid, snapshot).toBeDefined()
            const styles = await run("get_css_styles", { pageId, uid })
            expect(styles).toContain("margin-left")
            expect(styles).toContain("13px")

            // ADR-195: --no-javascript-evaluation makes the bridge refuse a javascript: navigation too.
            await expect(run("navigate_page", { pageId, url: "javascript:alert(1)" })).rejects.toThrow()

            await run("close_page", { pageId })
          } finally {
            await Instance.dispose()
          }
        },
      })
    } finally {
      server.closeAllConnections()
    }
  },
)
