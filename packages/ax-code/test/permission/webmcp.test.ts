import { afterEach, expect, test, vi } from "vitest"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

function request(ruleset: Permission.Ruleset) {
  return {
    sessionID: SessionID.make("ses_webmcp"),
    permission: "webmcp",
    patterns: ["bridge_execute_webmcp_tool"],
    metadata: {},
    always: [],
    ruleset,
  }
}

test.each([false, true])(
  "WebMCP requires per-call approval even with wildcard, persisted and autonomous grants (%s)",
  async (autonomous) => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", String(autonomous))
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
    await using tmp = await tmpdir({ git: true, config: { experimental: { autonomous_strict_permission: false } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const reply of ["always", "once"] as const) {
          const controller = new AbortController()
          const pending = Permission.ask(
            request([
              { permission: "*", pattern: "*", action: "allow" },
              { permission: "webmcp", pattern: "*", action: "allow" },
            ]),
            { signal: controller.signal },
          )
          // Attach a rejection handler before cleanup can abort a failed assertion.
          pending.catch(() => {})
          try {
            await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(1))
            const [approval] = await Permission.list()
            expect(approval).toMatchObject({ permission: "webmcp", always: [] })
            await Permission.reply({ requestID: approval.id, reply })
            await pending
          } finally {
            controller.abort()
          }
        }
      },
    })
  },
)

test("WebMCP preserves explicit denies and cancellation", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        Permission.ask(request([{ permission: "webmcp", pattern: "*", action: "deny" }])),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
      expect(await Permission.list()).toHaveLength(0)
      const controller = new AbortController()
      const pending = Permission.ask(request([]), { signal: controller.signal })
      const rejected = expect(pending).rejects.toThrow()
      await vi.waitFor(async () => expect(await Permission.list()).toHaveLength(1))
      controller.abort()
      await rejected
      expect(await Permission.list()).toHaveLength(0)
    },
  })
})
