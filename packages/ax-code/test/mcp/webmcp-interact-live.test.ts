import { expect, test } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import { execFileSync } from "node:child_process"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { MCP } from "../../src/mcp"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PAGES } from "../fixture/webmcp/pages"

// Opt-in live qualification of the T2 interact tier (ADR-174, PRD R14)
// against the pinned bridge and a real Chrome 150+. It drives the converted
// tools directly (grants are recorded through the MCP API, as the session
// layer does after a prompt), so it checks the dispatch layer: uid binding,
// real actions, dialog handling. Isolated headless browser; no user profile.
const executablePath = process.env.AX_TEST_WEBMCP_CHROME
test.skipIf(!executablePath)(
  "T2 interact tools act on real fixture pages and fail closed on stale targets",
  { timeout: 120_000, retry: 0 },
  async () => {
    await using server = createServer((request, response) => {
      const page = PAGES[request.url ?? ""]
      response.statusCode = page ? 200 : 404
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(page ?? "<!doctype html><title>missing</title>")
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    const origin = `http://127.0.0.1:${address.port}`
    // The grant API reads the entry from config, so the bridge is configured
    // (disabled) and then connected by the explicit gesture, as the chip does.
    const entry = {
      ...WebMcpProfile.config({ allowedOrigins: [], headless: true, executablePath, read: true, interact: true }, false),
      timeout: 60_000,
    }
    await using tmp = await tmpdir({ git: true, config: { mcp: { live: entry } } as never })
    console.info(
      `WebMCP T2 qualification: ${WebMcpProfile.PACKAGE}; ${execFileSync(executablePath!, ["--version"], { encoding: "utf8" }).trim()}`,
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await MCP.connect("live")
          const status = (await MCP.status()).live
          expect(status, JSON.stringify(status)).toMatchObject({ status: "connected" })
          expect((await MCP.grantWebMcpReadOrigin("live", origin)).ok).toBe(true)
          expect((await MCP.grantWebMcpInteractOrigin("live", origin)).ok).toBe(true)
          const tools = await MCP.tools()
          for (const name of WebMcpProfile.INTERACT_TOOLS) expect(tools[`live_${name}`], name).toBeDefined()
          const run = async (name: string, args: Record<string, unknown>) => {
            const result = await tools[`live_${name}`].execute!(args, { toolCallId: `live_${name}`, messages: [] })
            return CallToolResultSchema.parse(result)
              .content.flatMap((item) => (item.type === "text" ? [item.text] : []))
              .join("\n")
          }
          const open = async (path: string) => {
            await run("new_page", { url: `${origin}${path}` })
            const pages = await run("list_pages", {})
            const line = pages.split("\n").find((entry) => entry.includes(`${origin}${path}`))
            const pageId = Number(/^(\d+):/.exec(line ?? "")?.[1])
            expect(Number.isSafeInteger(pageId), pages).toBe(true)
            return pageId
          }
          const uidOf = (snapshot: string, role: string, name: string) => {
            const match = new RegExp(`uid=(\\S+) ${role} "${name}"`).exec(snapshot)
            expect(match, snapshot).not.toBeNull()
            return match![1]!
          }

          // Login form: fill a plain field, observe it, refuse a stale uid.
          const login = await open("/login")
          await expect(run("fill", { pageId: login, uid: "1_1", value: "x" })).rejects.toBeInstanceOf(
            WebMcpProfile.TargetBindingError,
          )
          const snapshot = await run("take_snapshot", { pageId: login })
          const nameUid = uidOf(snapshot, "textbox", "Full name")
          expect(WebMcpProfile.sensitiveTarget(WebMcpProfile.targetSummaryFor(tools.live_fill.webmcp!.profile, login, uidOf(snapshot, "textbox", "Password")))).toBe(true)
          expect(await run("fill", { pageId: login, uid: nameUid, value: "Jane Doe" })).toContain("Successfully filled")
          expect(await run("take_snapshot", { pageId: login })).toContain("Jane Doe")
          await expect(run("fill", { pageId: login, uid: "9_9", value: "x" })).rejects.toBeInstanceOf(
            WebMcpProfile.TargetBindingError,
          )

          // Dialog: a click opens confirm(); the page is blocked until handled.
          const dialogs = await open("/dialogs")
          const dialogSnapshot = await run("take_snapshot", { pageId: dialogs })
          const confirmUid = uidOf(dialogSnapshot, "button", "Open confirm")
          await run("click", { pageId: dialogs, uid: confirmUid }).catch(() => undefined)
          const blocked = await run("list_pages", {})
          expect(blocked).toContain("/dialogs")
          expect(await run("handle_dialog", { pageId: dialogs, action: "dismiss" })).toMatch(/dismiss|Successfully/i)

          // SPA route change: a same-origin URL change clears the uid map.
          const spa = await open("/spa")
          const spaSnapshot = await run("take_snapshot", { pageId: spa })
          const nextUid = uidOf(spaSnapshot, "button", "Next view")
          await run("click", { pageId: spa, uid: nextUid })
          expect(WebMcpProfile.targetSummaryFor(tools.live_click.webmcp!.profile, spa, nextUid)).toBeUndefined()
          await expect(run("click", { pageId: spa, uid: nextUid })).rejects.toBeInstanceOf(
            WebMcpProfile.TargetBindingError,
          )
        } finally {
          await Instance.dispose()
        }
      },
    })
  },
)
