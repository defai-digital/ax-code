import { expect, test, vi } from "vitest"
import { spawn } from "node:child_process"
const { token } = vi.hoisted(() => {
  const token = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replaceAll("-", "").slice(0, 43)
  process.env.AX_CODE_DESKTOP_BROWSER_TOKEN = token
  return { token }
})
import { Hono } from "hono"
import { serve } from "@/util/runtime-adapter"
import { DesktopBrowserRoutes } from "@/server/routes/desktop-browser"
import { DesktopBrowser } from "@/mcp/desktop-browser"
import { DesktopWebMcpTool } from "@/tool/desktop_webmcp"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { MessageID } from "@/session/schema"
import { Permission } from "@/permission"
import { Bus } from "@/bus"
import type { Tool } from "@/tool/tool"
import { tmpdir } from "../fixture/fixture"

test.runIf(Boolean(process.env.AX_TEST_DESKTOP_ELECTRON && process.env.AX_TEST_DESKTOP_HARNESS))(
  "native embedded browser invokes imperative/declarative tools through authenticated SDK dispatch",
  async () => {
    await using tmp = await tmpdir({ git: true })
    const app = new Hono()
      .use(async (_c, next) => {
        await Instance.provide({ directory: tmp.path, fn: next })
      })
      .route("/desktop/browser", DesktopBrowserRoutes())
    const server = await serve({ app, hostname: "127.0.0.1", port: 0 })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            AX_TEST_BROWSER_TOKEN: token,
            AX_TEST_BROWSER_ORIGIN: server.url.origin,
            AX_TEST_BROWSER_DIRECTORY: tmp.path,
            AX_TEST_BROWSER_SESSION: session.id,
          }
          delete env.ELECTRON_RUN_AS_NODE
          const child = spawn(process.env.AX_TEST_DESKTOP_ELECTRON!, [process.env.AX_TEST_DESKTOP_HARNESS!], {
            env,
            stdio: ["pipe", "pipe", "pipe"],
          })
          let output = ""
          let stderr = ""
          child.stdout.on("data", (data) => {
            output += String(data)
          })
          child.stderr.on("data", (data) => {
            stderr += String(data).slice(0, 4096)
          })
          const exited = new Promise<number | null>((resolve) => child.once("exit", resolve))
          const unsubscribe = Bus.subscribe(Permission.Event.Asked, (event) => {
            expect(event.properties.permission).toBe("webmcp")
            void Permission.reply({ requestID: event.properties.id, reply: "once" })
          })
          try {
            await vi.waitFor(() => expect(output, stderr).toContain("NATIVE_BROWSER_READY"), { timeout: 15000 })
            const tool = await DesktopWebMcpTool.init()
            const ctx: Tool.Context = {
              sessionID: session.id,
              messageID: MessageID.ascending(),
              agent: "build",
              messages: [],
              abort: new AbortController().signal,
              metadata: () => {},
              ask: (request) => Permission.ask({ ...request, sessionID: session.id, ruleset: [] }),
            }
            const catalog = await DesktopBrowser.list(DesktopBrowser.forSession(session.id), ctx.abort)
            expect(catalog.map((tool) => tool.name).sort()).toEqual(["echo", "form_echo", "manual_echo", "wait"])
            for (const name of ["echo", "form_echo"]) {
              const definition = catalog.find((tool) => tool.name === name)!
              const result = await tool.execute(
                {
                  action: "invoke",
                  toolName: name,
                  digest: definition.digest,
                  input: { value: "native-contract-result" },
                },
                ctx,
              )
              expect(result.output).toContain("native-contract-result")
              if (name === "form_echo") expect(result.output).toContain('"agentInvoked":true')
            }
            const manual = catalog.find((tool) => tool.name === "manual_echo")!
            let submitted = false
            const manualResult = tool
              .execute(
                {
                  action: "invoke",
                  toolName: manual.name,
                  digest: manual.digest,
                  input: { value: "manual-native-result" },
                },
                ctx,
              )
              .then((result) => {
                submitted = true
                return result
              })
            await new Promise((resolve) => setTimeout(resolve, 200))
            expect(submitted).toBe(false)
            child.stdin.write("submit\n")
            expect((await manualResult).output).toContain("manual-native-result")
            const controller = new AbortController()
            const waiting = catalog.find((tool) => tool.name === "wait")!
            const pending = DesktopBrowser.invoke(
              DesktopBrowser.forSession(session.id),
              "wait",
              waiting.digest,
              {},
              controller.signal,
            )
            const rejected = expect(pending).rejects.toThrow()
            await new Promise((resolve) => setTimeout(resolve, 100))
            controller.abort()
            await rejected
            const stale = DesktopBrowser.forSession(session.id)
            child.stdin.write("reload\n")
            await vi.waitFor(
              () => expect(DesktopBrowser.forSession(session.id).generation).not.toBe(stale.generation),
              { timeout: 5000 },
            )
            await expect(DesktopBrowser.list(stale, ctx.abort)).rejects.toThrow()
            child.stdin.write("hide\n")
            await vi.waitFor(() => expect(() => DesktopBrowser.forSession(session.id)).toThrow(), { timeout: 5000 })
            console.log(
              "Native authenticated SDK + permission dispatch passed on embedded Chromium; Chrome was not launched.",
            )
          } finally {
            unsubscribe()
            child.stdin.write("stop\n")
            const timeout = setTimeout(() => child.kill("SIGKILL"), 3000)
            await exited
            clearTimeout(timeout)
          }
        },
      })
    } finally {
      await server.stop(true)
      await Instance.disposeAll()
    }
  },
  30000,
)
