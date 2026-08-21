import { describe, expect, test } from "vitest"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { Bus } from "../../src/bus"
import { NotificationEvent } from "../../src/notification/events"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async (_req?: PermissionRequest) => {},
}

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

// Intercepted browser opens return before bash-impl reaches spawn(); the
// "does NOT intercept" cases stop at the permission ask, also before spawn.
describe("tool.bash browser-open interception", () => {
  test("intercepts open targeting a local HTML file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: "open index.html", description: "Open HTML file" }, ctx)
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("index.html")
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("intercepts quoted open targeting a local HTML file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: 'open "index.html"', description: "Open quoted HTML file" }, ctx)
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("index.html")
      },
    })
  })

  test("intercepts indented open targeting a local HTML file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: "  open index.html", description: "Open indented HTML file" }, ctx)
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("index.html")
      },
    })
  })

  test("intercepts xdg-open targeting a local HTML file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: "xdg-open game.html", description: "Open game" }, ctx)
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("game.html")
      },
    })
  })

  test("intercepts open targeting localhost URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "open http://localhost:3000", description: "Open dev server" },
          ctx,
        )
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("localhost:3000")
      },
    })
  })

  test("intercepts open targeting shared local host aliases", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        for (const target of ["http://api.localhost:3000", "http://127.12.0.1:3000", "http://0.0.0.0:3000"]) {
          const result = await bash.execute({ command: `open ${target}`, description: "Open local dev server" }, ctx)
          expect(result.output).toContain("[Browser open intercepted]")
          expect(result.output).toContain(target.replace("http://", ""))
        }
      },
    })
  })

  test("intercepts open with app options targeting localhost URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "open -a Safari http://localhost:3000", description: "Open dev server in Safari" },
          ctx,
        )
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("localhost:3000")
      },
    })
  })

  test("does NOT intercept open targeting an oauth callback URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        let spawned = false
        const trackCtx = {
          ...ctx,
          ask: async () => {
            spawned = true
            throw new Error("stop after permission")
          },
        }
        try {
          await bash.execute(
            { command: "open http://localhost:9999/oauth/callback", description: "OAuth callback" },
            trackCtx,
          )
        } catch {
          // permission throw is expected
        }
        expect(spawned).toBe(true)
      },
    })
  })

  test("does NOT intercept open targeting a non-local URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        let spawned = false
        const trackCtx = {
          ...ctx,
          ask: async () => {
            spawned = true
            throw new Error("stop after permission")
          },
        }
        try {
          await bash.execute({ command: "open https://example.com", description: "Open external site" }, trackCtx)
        } catch {
          // permission throw is expected
        }
        expect(spawned).toBe(true)
      },
    })
  })

  test("does NOT intercept open targeting loopback-looking remote hostnames", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const attempted: string[] = []
        const trackCtx = {
          ...ctx,
          ask: async (req?: PermissionRequest) => {
            attempted.push(...(req?.patterns ?? []))
            throw new Error("stop after permission")
          },
        }

        for (const command of ["open http://127.0.0.1.evil.com", "open http://localhost.evil.com"]) {
          try {
            await bash.execute({ command, description: "Open remote site" }, trackCtx)
          } catch {
            // permission throw is expected
          }
        }

        expect(attempted).toEqual(["open http://127.0.0.1.evil.com", "open http://localhost.evil.com"])
      },
    })
  })

  test("does NOT intercept open targeting a remote URL with .html extension", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        let spawned = false
        const trackCtx = {
          ...ctx,
          ask: async () => {
            spawned = true
            throw new Error("stop after permission")
          },
        }
        try {
          await bash.execute(
            { command: "open https://example.com/page.html", description: "Open remote HTML page" },
            trackCtx,
          )
        } catch {
          // permission throw is expected
        }
        expect(spawned).toBe(true)
      },
    })
  })

  test("emits NotificationEvent.ToastShow when browser open is intercepted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const toasts: Array<{ title?: string; message: string; variant: string }> = []
        const unsub = Bus.subscribe(NotificationEvent.ToastShow, (event) => {
          toasts.push(event.properties)
        })
        try {
          const bash = await BashTool.init()
          await bash.execute({ command: "open index.html", description: "Open HTML file" }, ctx)
          // publishDetached is fire-and-forget — give the microtask queue a turn
          await new Promise((r) => setTimeout(r, 10))
          expect(toasts.length).toBeGreaterThan(0)
          expect(toasts[0].title).toBe("Browser preview ready")
          expect(toasts[0].variant).toBe("info")
          expect(toasts[0].message).toContain("index.html")
        } finally {
          unsub()
        }
      },
    })
  })
})
