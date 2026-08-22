import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ComputerUseError, McpClientError } from "@ax-code/computer"
import type { Permission } from "../../src/permission"
import { Computer } from "../../src/computer/computer"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { ComputerSnapshotTool } from "../../src/tool/computer/computer_snapshot"
import { ComputerActionTool } from "../../src/tool/computer/computer_action"
import { checkVisualRouting } from "../../src/visual/router"
import { tmpdir } from "../fixture/fixture"
import { FakeComputerProvider } from "./computer-fixture"

vi.mock("@/visual/router", () => ({
  checkVisualRouting: vi.fn(async () => ({ ok: true, model: { id: "test-model" }, providerID: "test", caps: {} })),
}))

// Computer.resolveBackend honors AX_COMPUTER_*_COMMAND host env overrides; the
// unavailable-backend diagnostic below asserts the default command, so pin the
// overrides away to keep the test host-independent.
beforeEach(() => {
  vi.stubEnv("AX_COMPUTER_CUA_COMMAND", undefined)
  vi.stubEnv("AX_COMPUTER_OCU_COMMAND", undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

type Ask = Omit<Permission.Request, "id" | "sessionID" | "tool">

function makeCtx(asks: Ask[]) {
  return {
    sessionID: "ses_computer_test" as never,
    messageID: "msg_computer_test" as never,
    agent: "test",
    abort: new AbortController().signal,
    messages: [],
    metadata: vi.fn(),
    ask: vi.fn(async (input: Ask) => {
      asks.push(input)
    }),
  }
}

async function setup(
  config: Parameters<typeof tmpdir>[0],
  fn: (input: { provider: FakeComputerProvider; asks: Ask[] }) => Promise<void>,
) {
  await using tmp = await tmpdir(config)
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new FakeComputerProvider()
      await Computer.useProvider(provider)
      const asks: Ask[] = []
      await fn({ provider, asks })
    },
  })
}

describe("computer tools gating", () => {
  test("unavailable without computer.provider config", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).not.toContain("computer_snapshot")
        expect(ids).not.toContain("computer_action")
        expect(await Computer.configured()).toBe(false)
        await expect(Computer.observe({ desktop: true })).rejects.toThrow(/not configured/)
      },
    })
  })

  test("available when computer.provider is set", async () => {
    await using tmp = await tmpdir({ config: { computer: { provider: "cua" } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("computer_snapshot")
        expect(ids).toContain("computer_action")
        // lazy: status must not construct the backend provider
        expect(await Computer.status()).toMatchObject({ configured: true, provider: "cua", activeProvider: undefined })
      },
    })
  })
})

describe("computer_snapshot tool", () => {
  test("returns elements and a screenshot attachment", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      const tool = await ComputerSnapshotTool.init()
      const result = await tool.execute({ includeScreenshot: true }, makeCtx(asks))

      expect(asks[0]).toMatchObject({ permission: "computer", patterns: ["observe:desktop"] })
      expect(result.output).toContain('[e1:save-btn] button "Save"')
      expect(result.metadata.elementCount).toBe(2)
      expect(result.attachments).toHaveLength(1)
      expect(result.attachments![0]!.url).toMatch(/^data:image\/png;base64,/)
      expect(provider.scopes).toEqual([{ desktop: true }])
    })
  })

  test("scopes the observation and permission to the requested app", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      const tool = await ComputerSnapshotTool.init()
      await tool.execute({ app: "TextEdit", includeScreenshot: false }, makeCtx(asks))

      expect(asks[0]).toMatchObject({ permission: "computer", patterns: ["observe:app:TextEdit"] })
      expect(provider.scopes).toEqual([{ app: "TextEdit" }])
    })
  })

  test("desktop scope lists discoverable apps and windows; app scope does not", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async () => {
      const tool = await ComputerSnapshotTool.init()

      const desktop = await tool.execute({ includeScreenshot: false }, makeCtx([]))
      expect(desktop.output).toContain("Available apps")
      expect(desktop.output).toContain("- TextEdit")
      expect(desktop.output).toContain("- [101] Untitled (TextEdit)")
      expect(desktop.metadata).toMatchObject({ appCount: 1, windowCount: 1 })

      const scoped = await tool.execute({ app: "TextEdit", includeScreenshot: false }, makeCtx([]))
      expect(scoped.output).not.toContain("Available apps")
      expect(scoped.metadata.appCount).toBeUndefined()
    })
  })

  test("unavailable backend fails with the command tried and the env override", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      vi.spyOn(provider, "observe").mockRejectedValue(new McpClientError("spawn_failed", "command not found"))
      const tool = await ComputerSnapshotTool.init()

      await expect(tool.execute({ includeScreenshot: true }, makeCtx([]))).rejects.toThrow(
        /cua-driver mcp.*AX_COMPUTER_CUA_COMMAND/s,
      )
    })
  })

  test("provider scoping errors surface their own message instead of a backend-unavailable wrap", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      // providers use provider_error for user-fixable scoping failures (app
      // not running, window gone); the backend itself is fine
      vi.spyOn(provider, "observe").mockRejectedValue(
        new ComputerUseError('cua: app "Nosuch" not found or not running', { provider: "cua", code: "provider_error" }),
      )
      const tool = await ComputerSnapshotTool.init()

      const err = await tool.execute({ app: "Nosuch", includeScreenshot: false }, makeCtx([])).catch((e) => e)
      expect(err.message).toContain('app "Nosuch" not found')
      expect(err.message).not.toContain("is unavailable")
    })
  })

  test("rejects app and windowId together before any permission ask or observation", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      const tool = await ComputerSnapshotTool.init()

      await expect(
        tool.execute({ app: "TextEdit", windowId: "101", includeScreenshot: false }, makeCtx(asks)),
      ).rejects.toThrow(/at most one of app or windowId/)
      expect(asks).toHaveLength(0)
      expect(provider.scopes).toHaveLength(0)
    })
  })

  test("vision-incapable model fails before any permission ask or observation", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      vi.mocked(checkVisualRouting).mockResolvedValueOnce({ ok: false, diagnostic: "model has no vision input" })
      const tool = await ComputerSnapshotTool.init()

      await expect(tool.execute({ includeScreenshot: true }, makeCtx(asks))).rejects.toThrow(/no vision input/)
      expect(asks).toHaveLength(0)
      expect(provider.scopes).toHaveLength(0)
    })
  })
})

describe("computer_action tool", () => {
  test("executes the action and re-observes the same scope", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      const snapshot = await ComputerSnapshotTool.init()
      await snapshot.execute({ includeScreenshot: true }, makeCtx(asks))

      const tool = await ComputerActionTool.init()
      const result = await tool.execute({ type: "click", target: { x: 10, y: 20 } }, makeCtx(asks))

      // scope-based permission pattern survives across snapshots
      expect(asks[1]).toMatchObject({
        permission: "computer",
        patterns: ["click:desktop"],
        always: ["click:desktop", "click:*"],
      })
      expect(provider.acts).toEqual([
        { type: "click", target: { kind: "point", x: 10, y: 20 }, button: undefined, count: undefined },
      ])
      // verify-after-act: snapshot observe + re-observe of the same scope
      expect(provider.scopes).toEqual([{ desktop: true }, { desktop: true }])
      expect(result.output).toContain("click (10,20): ok")
      expect(result.output).toContain("Fresh observation after the action:")
      expect(result.output).toContain('[e1:save-btn] button "Save"')
      expect(result.attachments).toHaveLength(1)
    })
  })

  test("stale element id throws re-observe guidance", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      const tool = await ComputerActionTool.init()
      await expect(tool.execute({ type: "click", target: "e1:gone" }, makeCtx([]))).rejects.toThrow(/computer_snapshot/)
      expect(provider.acts).toHaveLength(0)
    })
  })

  test("element id from another epoch is rejected as stale even when the raw id exists", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      const snapshot = await ComputerSnapshotTool.init()
      await snapshot.execute({ includeScreenshot: false }, makeCtx([]))

      const tool = await ComputerActionTool.init()
      // current-epoch ids are e1:*; an e0: id must never resolve to the raw
      // provider id, or a dangling index would reach the backend
      await expect(tool.execute({ type: "click", target: "e0:save-btn" }, makeCtx([]))).rejects.toThrow(
        /computer_snapshot/,
      )
      expect(provider.acts).toHaveLength(0)
    })
  })

  test("vision-incapable model fails before any permission ask or action", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      vi.mocked(checkVisualRouting).mockResolvedValueOnce({ ok: false, diagnostic: "model has no vision input" })
      const tool = await ComputerActionTool.init()

      await expect(tool.execute({ type: "click", target: { x: 1, y: 2 } }, makeCtx(asks))).rejects.toThrow(
        /no vision input/,
      )
      expect(asks).toHaveLength(0)
      expect(provider.acts).toHaveLength(0)
    })
  })

  test("backend refusal is returned prominently", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      provider.refusal = "background_unavailable"
      const tool = await ComputerActionTool.init()
      const result = await tool.execute({ type: "keypress", keys: ["return"] }, makeCtx(asks))

      // no prior observation: the pattern falls back to the bare action type
      expect(asks[0]).toMatchObject({ permission: "computer", patterns: ["keypress"], always: ["keypress"] })
      expect(result.output).toContain("REFUSED")
      expect(result.output).toContain("background_unavailable")
      expect(result.metadata.ok).toBe(false)
      expect(result.metadata.refusal).toBe("background_unavailable")
    })
  })

  test("re-observation failure does not mask a successful action result", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      const tool = await ComputerActionTool.init()
      vi.spyOn(provider, "observe").mockRejectedValueOnce(new Error("screen capture permission revoked"))
      const result = await tool.execute({ type: "click", target: { x: 10, y: 20 } }, makeCtx([]))

      // the action executed; the tool must report that instead of throwing
      expect(provider.acts).toHaveLength(1)
      expect(result.metadata.ok).toBe(true)
      expect(result.output).toContain("click (10,20): ok")
      expect(result.output).toContain("Re-observation failed")
      expect(result.output).toContain("screen capture permission revoked")
      expect(result.metadata.reobserveError).toContain("screen capture permission revoked")
      expect(result.metadata.elementCount).toBeUndefined()
      expect(result.attachments).toBeUndefined()
    })
  })

  test("re-observation failure does not mask a refusal either", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      provider.refusal = "background_unavailable"
      const tool = await ComputerActionTool.init()
      vi.spyOn(provider, "observe").mockRejectedValueOnce(new Error("backend gone"))
      const result = await tool.execute({ type: "keypress", keys: ["return"] }, makeCtx([]))

      expect(result.output).toContain("REFUSED")
      expect(result.output).toContain("background_unavailable")
      expect(result.output).toContain("Re-observation failed")
      expect(result.metadata.ok).toBe(false)
      expect(result.metadata.refusal).toBe("background_unavailable")
    })
  })
})
