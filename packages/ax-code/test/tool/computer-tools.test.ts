import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ComputerUseError, McpClientError } from "@ax-code/computer"
import type { Permission } from "../../src/permission"
import { Computer } from "../../src/computer/computer"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { ComputerSnapshotTool } from "../../src/tool/computer/computer_snapshot"
import { ComputerActionTool } from "../../src/tool/computer/computer_action"
import { ComputerWatchTool } from "../../src/tool/computer/computer_watch"
import { ComputerPlanTool } from "../../src/tool/computer/computer_plan"
import { _setPlanDepsForTests } from "../../src/tool/computer/plan"
import type { PlanJudgeDeps } from "../../src/tool/computer/plan"
import { _setGroundDepsForTests, parseGroundPoint } from "../../src/computer/ground"
import { renderTrajectory } from "../../src/tool/computer/render"
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
  _setPlanDepsForTests(undefined)
  _setGroundDepsForTests(undefined)
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
        expect(ids).not.toContain("computer_watch")
        expect(ids).not.toContain("computer_plan")
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
        expect(ids).toContain("computer_watch")
        expect(ids).toContain("computer_plan")
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

  test("records a reflection trajectory across observe and act steps", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async () => {
      const snapshot = await ComputerSnapshotTool.init()
      await snapshot.execute({ includeScreenshot: false }, makeCtx([]))

      const tool = await ComputerActionTool.init()
      const result = await tool.execute({ type: "click", target: { x: 10, y: 20 } }, makeCtx([]))

      expect(result.output).toContain("Recent trajectory:")
      expect(result.output).toContain("1. observe desktop")
      expect(result.output).toContain("2. click (10,20) → ok")

      const entries = await Computer.trajectory()
      expect(entries.map((e) => e.kind)).toEqual(["observe", "act"])
      expect(entries[1]).toMatchObject({ summary: "click (10,20)", ok: true })
    })
  })

  test("trajectory records refusals and caps at 20 entries", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider }) => {
      provider.refusal = "background_unavailable"
      const tool = await ComputerActionTool.init()
      const result = await tool.execute({ type: "keypress", keys: ["return"] }, makeCtx([]))
      expect(result.output).toContain("1. keypress return → REFUSED (background_unavailable)")

      provider.refusal = undefined
      for (let i = 0; i < 25; i++) {
        await tool.execute({ type: "keypress", keys: ["a"] }, makeCtx([]))
      }
      const entries = await Computer.trajectory()
      expect(entries).toHaveLength(20)
      expect(entries.at(-1)).toMatchObject({ summary: "keypress a", ok: true })
    })
  })
})

describe("computer_watch tool", () => {
  test("reports a change timeline and the final observation", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      let calls = 0
      const original = provider.observe.bind(provider)
      vi.spyOn(provider, "observe").mockImplementation(async (scope) => {
        calls++
        const observation = await original(scope)
        if (calls >= 2) {
          observation.elements = [...observation.elements, { id: `extra-${calls}`, role: "button", name: "New" }]
        }
        return observation
      })

      const tool = await ComputerWatchTool.init()
      const result = await tool.execute({ durationMs: 600, intervalMs: 200, includeScreenshot: false }, makeCtx(asks))

      expect(asks[0]).toMatchObject({ permission: "computer", patterns: ["watch:desktop"] })
      expect(result.metadata.changes).toBeGreaterThan(0)
      expect(result.output).toContain("Watched desktop")
      expect(result.output).toContain("elements 2 → 3")
      expect(result.output).toContain("Final observation:")
      expect(provider.scopes.length).toBeGreaterThanOrEqual(2)
    })
  })

  test("no-change watch reports a clean timeline", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async () => {
      const tool = await ComputerWatchTool.init()
      const result = await tool.execute({ durationMs: 500, intervalMs: 200, includeScreenshot: false }, makeCtx([]))

      expect(result.metadata.changes).toBe(0)
      expect(result.output).toContain("No changes detected.")
    })
  })

  test("aborted watch returns the partial result", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async () => {
      const tool = await ComputerWatchTool.init()
      const ctx = { ...makeCtx([]), abort: AbortSignal.abort() }
      const result = await tool.execute({ durationMs: 5000, intervalMs: 200, includeScreenshot: false }, ctx)

      expect(result.metadata.aborted).toBe(true)
      expect(result.metadata.polls).toBe(1)
    })
  })
})

describe("computer_plan tool", () => {
  const planA = {
    title: "Direct save",
    steps: ["Click the Save button", "Confirm the dialog"],
    risks: ["dialog may not appear"],
  }
  const planB = {
    title: "Menu route",
    steps: ["Open the File menu", "Click the Save menu item"],
    risks: [],
  }

  test("generates candidates in parallel, judge picks the winner, plan recorded", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      const generateCandidate = vi.fn<NonNullable<PlanJudgeDeps["generateCandidate"]>>(async ({ temperature }) =>
        temperature === 0.4 ? planA : planB,
      )
      const judge = vi.fn<NonNullable<PlanJudgeDeps["judge"]>>(async () => ({
        winner: 1,
        rationale: "menu route matches the visible menu bar",
      }))
      _setPlanDepsForTests({ generateCandidate, judge })

      const tool = await ComputerPlanTool.init()
      const result = await tool.execute({ task: "Save the document", candidates: 2 }, makeCtx(asks))

      expect(asks[0]).toMatchObject({ permission: "computer", patterns: ["plan:desktop"] })
      expect(generateCandidate).toHaveBeenCalledTimes(2)
      const temperatures = generateCandidate.mock.calls.map((call) => call[0].temperature).sort()
      expect(temperatures).toEqual([0.4, 0.8])
      expect(judge).toHaveBeenCalledTimes(1)

      expect(result.output).toContain('winner: "Menu route" (candidate 2 of 2)')
      expect(result.output).toContain("1. Open the File menu")
      expect(result.output).toContain("Judge rationale: menu route matches the visible menu bar")
      expect(result.output).toContain("- Direct save")
      expect(result.metadata).toMatchObject({ winner: 1, candidateCount: 2, scope: "desktop" })
      expect(provider.scopes).toEqual([{ desktop: true }])

      const entries = await Computer.trajectory()
      expect(entries.at(-1)).toMatchObject({ kind: "plan", summary: 'plan "Save the document" → Menu route' })
      // plan entries render without an outcome suffix (that arrow is the summary's own)
      expect(renderTrajectory(entries)).toBe('1. plan "Save the document" → Menu route')
    })
  })

  test("candidates: 1 skips the judge entirely", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async () => {
      const judge = vi.fn<NonNullable<PlanJudgeDeps["judge"]>>(async () => ({ winner: 0, rationale: "unused" }))
      _setPlanDepsForTests({ generateCandidate: async () => planA, judge })

      const tool = await ComputerPlanTool.init()
      const result = await tool.execute({ task: "Save the document", candidates: 1 }, makeCtx([]))

      expect(judge).not.toHaveBeenCalled()
      expect(result.output).toContain('winner: "Direct save" (candidate 1 of 1)')
      expect(result.output).toContain("Judging skipped")
      expect(result.metadata).toMatchObject({ winner: 0, candidateCount: 1 })
    })
  })

  test("judge failure falls back to the first candidate with a note", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async () => {
      const generateCandidate = vi.fn<NonNullable<PlanJudgeDeps["generateCandidate"]>>(async ({ temperature }) =>
        temperature === 0.4 ? planA : planB,
      )
      _setPlanDepsForTests({
        generateCandidate,
        judge: async () => {
          throw new Error("model returned junk")
        },
      })

      const tool = await ComputerPlanTool.init()
      const result = await tool.execute({ task: "Save the document", candidates: 2 }, makeCtx([]))

      expect(result.output).toContain('winner: "Direct save" (candidate 1 of 2)')
      expect(result.output).toContain("Judging skipped")
      expect(result.output).toContain("- Menu route")
      expect(result.metadata).toMatchObject({ winner: 0, candidateCount: 2 })
    })
  })

  test("scoped plan asks with the scoped descriptor", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      _setPlanDepsForTests({ generateCandidate: async () => planA })

      const tool = await ComputerPlanTool.init()
      await tool.execute({ task: "Save the document", candidates: 1, app: "TextEdit" }, makeCtx(asks))

      expect(asks[0]).toMatchObject({ permission: "computer", patterns: ["plan:app:TextEdit"] })
      expect(provider.scopes).toEqual([{ app: "TextEdit" }])
    })
  })
})

describe("computer_action describe targets (grounder)", () => {
  const grounded = { config: { computer: { provider: "cua" as const, grounder: { model: "test/ui-tars" } } } }

  test("describe target is grounded to a point and acted on", async () => {
    await setup(grounded, async ({ provider, asks }) => {
      // fixture observation is a 2x2 screenshot; grounded coords clamp into it
      const ask = vi.fn(async () => '{"x": 1, "y": 1}')
      _setGroundDepsForTests({ ask })

      const snapshot = await ComputerSnapshotTool.init()
      await snapshot.execute({ includeScreenshot: true }, makeCtx(asks))

      const tool = await ComputerActionTool.init()
      const result = await tool.execute(
        { type: "click", target: { describe: "the Save button in the toolbar" } },
        makeCtx(asks),
      )

      expect(ask).toHaveBeenCalledTimes(1)
      expect(provider.acts).toEqual([
        { type: "click", target: { kind: "point", x: 1, y: 1 }, button: undefined, count: undefined },
      ])
      expect(result.output).toContain('click describe:"the Save button in the toolbar": ok')
      // observe ask + action ask — exactly one permission ask for the action
      expect(asks.filter((a) => a.permission === "computer")).toHaveLength(2)
      expect(asks[1]).toMatchObject({ permission: "computer", patterns: ["click:desktop"] })
    })
  })

  test("grounder unconfigured → actionable error, no act, no ask", async () => {
    await setup({ config: { computer: { provider: "cua" } } }, async ({ provider, asks }) => {
      const tool = await ComputerActionTool.init()
      await expect(
        tool.execute({ type: "click", target: { describe: "the Save button" } }, makeCtx(asks)),
      ).rejects.toThrow(/computer\.grounder/)
      expect(provider.acts).toHaveLength(0)
      expect(asks).toHaveLength(0)
    })
  })

  test("no prior observation → call computer_snapshot first", async () => {
    await setup(grounded, async ({ provider, asks }) => {
      _setGroundDepsForTests({ ask: async () => '{"x": 1, "y": 1}' })
      const tool = await ComputerActionTool.init()
      await expect(
        tool.execute({ type: "click", target: { describe: "the Save button" } }, makeCtx(asks)),
      ).rejects.toThrow(/computer_snapshot first/)
      expect(provider.acts).toHaveLength(0)
    })
  })

  test("unparseable grounder response → clear error, no act", async () => {
    await setup(grounded, async ({ provider }) => {
      _setGroundDepsForTests({ ask: async () => "I cannot locate that element, sorry." })
      const snapshot = await ComputerSnapshotTool.init()
      await snapshot.execute({ includeScreenshot: true }, makeCtx([]))

      const tool = await ComputerActionTool.init()
      await expect(
        tool.execute({ type: "click", target: { describe: "the Save button" } }, makeCtx([])),
      ).rejects.toThrow(/could not be parsed into coordinates/)
      expect(provider.acts).toHaveLength(0)
    })
  })
})

describe("parseGroundPoint", () => {
  const image = { width: 100, height: 50 }

  test("parses clean JSON", () => {
    expect(parseGroundPoint('{"x": 12, "y": 34}', image)).toEqual({ x: 12, y: 34 })
  })

  test("parses prose-wrapped JSON", () => {
    expect(parseGroundPoint('The element is at {"x": 12, "y": 34} as requested.', image)).toEqual({ x: 12, y: 34 })
  })

  test("clamps out-of-bounds coordinates to the image", () => {
    expect(parseGroundPoint('{"x": 500, "y": -10}', image)).toEqual({ x: 99, y: 0 })
  })

  test("falls back to a bare number pair", () => {
    expect(parseGroundPoint("approximately 42, 17 pixels", image)).toEqual({ x: 42, y: 17 })
  })

  test("garbage response throws a clear error", () => {
    expect(() => parseGroundPoint("no idea where that is", image)).toThrow(/could not be parsed into coordinates/)
  })
})
