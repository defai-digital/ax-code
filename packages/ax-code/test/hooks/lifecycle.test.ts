import { describe, expect, test, vi, afterEach } from "vitest"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import os from "os"
import path from "path"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("LifecycleHooks official packs", () => {
  test("ships at least 5 builtin packs covering PreToolUse, PostToolUse, Stop", () => {
    const packs = LifecycleHooks.listBuiltinPacks()
    expect(packs.length).toBeGreaterThanOrEqual(5)
    const events = new Set(packs.flatMap((p) => p.hooks.map((h) => h.event)))
    expect(events.has("PreToolUse")).toBe(true)
    expect(events.has("PostToolUse")).toBe(true)
    expect(events.has("Stop")).toBe(true)
  })

  test("packCatalogMarkdown documents all packs", () => {
    const md = LifecycleHooks.packCatalogMarkdown()
    for (const pack of LifecycleHooks.listBuiltinPacks()) {
      expect(md).toContain(pack.name)
    }
  })
})

describe("LifecycleHooks matcher and run", () => {
  test("matcherHits supports pipe alternatives", () => {
    expect(LifecycleHooks.matcherHits("edit|write", "edit")).toBe(true)
    expect(LifecycleHooks.matcherHits("edit|write", "bash")).toBe(false)
    expect(LifecycleHooks.matcherHits("*", "anything")).toBe(true)
  })

  test("block-force-push PreToolUse blocks force push", async () => {
    const packs = LifecycleHooks.listBuiltinPacks()
    const hooks = packs.find((p) => p.name === "block-force-push")!.hooks
    const blocked = await LifecycleHooks.runHooks(hooks, {
      event: "PreToolUse",
      tool: "bash",
      args: { command: "git push --force origin main" },
      cwd: process.cwd(),
    })
    expect(blocked.blocked).toBe(true)
    expect(blocked.ok).toBe(false)

    const allowed = await LifecycleHooks.runHooks(hooks, {
      event: "PreToolUse",
      tool: "bash",
      args: { command: "git push origin main" },
      cwd: process.cwd(),
    })
    expect(allowed.blocked).toBe(false)
  })

  test("sends large hook arguments through stdin without exceeding spawn environment limits", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          command:
            "node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(String(JSON.parse(s).payload.length)))\"",
        },
      ],
      {
        event: "PreToolUse",
        args: { payload: "x".repeat(64 * 1024) },
      },
    )

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout).toBe(String(64 * 1024))
  })

  test("sanitizes inherited secrets while preserving hook protocol and platform variables", async () => {
    vi.stubEnv("AX_TEST_SECRET_KEY", "top-secret")
    vi.stubEnv("AX_TEST_SAFE", "visible")
    vi.stubEnv("SSH_AUTH_SOCK", "/tmp/test-agent.sock")
    vi.stubEnv("DATABASE_URL", "https://alice:secret@example.com/database")
    vi.stubEnv("NODE_OPTIONS", "--trace-warnings")
    vi.stubEnv("SYSTEMROOT", "C:\\Windows")
    vi.stubEnv("COMSPEC", "C:\\Windows\\System32\\cmd.exe")
    vi.stubEnv("USERPROFILE", "C:\\Users\\tester")
    vi.stubEnv("TEMP", "C:\\Temp")
    vi.stubEnv("PATHEXT", ".COM;.EXE")

    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          command: `node -e "const e=process.env;process.stdout.write([e.AX_TEST_SECRET_KEY||'',e.AX_TEST_SAFE||'',e.HOOK_EVENT||'',e.HOOK_ARGS_JSON||'',e.SSH_AUTH_SOCK||'',e.DATABASE_URL||'',e.NODE_OPTIONS||'',e.SYSTEMROOT||'',e.COMSPEC||'',e.USERPROFILE||'',e.TEMP||'',e.PATHEXT||''].join('\\n'))"`,
        },
      ],
      { event: "PreToolUse", args: { command: "echo hi" }, cwd: process.cwd() },
    )

    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout.split("\n")).toEqual([
      "",
      "visible",
      "PreToolUse",
      '{"command":"echo hi"}',
      "",
      "",
      "",
      "C:\\Windows",
      "C:\\Windows\\System32\\cmd.exe",
      "C:\\Users\\tester",
      "C:\\Temp",
      ".COM;.EXE",
    ])
  })

  test("restores the legacy full environment only through the host escape hatch", async () => {
    vi.stubEnv("AX_TEST_SECRET_KEY", "top-secret")
    vi.stubEnv("AX_CODE_HOOKS_FULL_ENV", "1")

    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          command: `node -e "process.stdout.write(process.env.AX_TEST_SECRET_KEY||'')"`,
        },
      ],
      { event: "PreToolUse", cwd: process.cwd() },
    )

    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout).toBe("top-secret")
  })

  test("does not let project hooks request the legacy full environment", async () => {
    vi.stubEnv("AX_TEST_SECRET_KEY", "top-secret")
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-hooks-env-bypass-"))
    await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".ax-code", "hooks.json"),
      JSON.stringify({
        hooks: [
          {
            event: "PreToolUse",
            command: `node -e "process.stdout.write(process.env.AX_TEST_SECRET_KEY||'')"`,
            fullEnv: true,
          },
        ],
      }),
      "utf8",
    )

    const hooks = await LifecycleHooks.loadProjectHooks(dir, true)
    const result = await LifecycleHooks.runHooks(hooks, { event: "PreToolUse", cwd: dir })

    expect(hooks).toHaveLength(1)
    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout).toBe("")
  })

  test("loads packs from .ax-code/hooks.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-hooks-"))
    await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".ax-code", "hooks.json"),
      JSON.stringify({ packs: ["log-bash-commands"] }),
      "utf8",
    )
    await expect(LifecycleHooks.loadProjectHooks(dir)).resolves.toEqual([])
    const hooks = await LifecycleHooks.loadProjectHooks(dir, true)
    expect(hooks.some((h) => h.pack === "log-bash-commands")).toBe(true)
  })

  test("UserPromptSubmit hooks can block via blockOnFailure", async () => {
    const hooks = [
      {
        event: "UserPromptSubmit" as const,
        blockOnFailure: true,
        command:
          "node -e \"const raw=process.env.HOOK_ARGS_JSON||'{}';const a=JSON.parse(raw);if(String(a.prompt||'').includes('forbidden')){console.error('blocked prompt');process.exit(2)}\"",
      },
    ]
    const blocked = await LifecycleHooks.runHooks(hooks, {
      event: "UserPromptSubmit",
      args: { prompt: "do the forbidden thing" },
      cwd: process.cwd(),
    })
    expect(blocked.blocked).toBe(true)

    const allowed = await LifecycleHooks.runHooks(hooks, {
      event: "UserPromptSubmit",
      args: { prompt: "do the normal thing" },
      cwd: process.cwd(),
    })
    expect(allowed.blocked).toBe(false)
  })

  test("non-blockable events never block even with blockOnFailure", async () => {
    for (const event of [
      "PreCompact",
      "SubagentStop",
      "PostToolUse",
      "Stop",
      "SessionStart",
      "SessionEnd",
      "PostCompact",
      "Interrupt",
    ] as const) {
      const result = await LifecycleHooks.runHooks([{ event, blockOnFailure: true, command: "exit 2" }], {
        event,
        cwd: process.cwd(),
      })
      expect(result.blocked).toBe(false)
    }
  })

  test("accepts new lifecycle events in project hooks.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-hooks-events-"))
    await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".ax-code", "hooks.json"),
      JSON.stringify({
        hooks: [
          { event: "UserPromptSubmit", command: "true" },
          { event: "PreCompact", command: "true" },
          { event: "SubagentStop", command: "true" },
          { event: "SessionStart", command: "true" },
          { event: "SessionEnd", command: "true" },
          { event: "PostCompact", command: "true" },
          { event: "Interrupt", command: "true" },
        ],
      }),
      "utf8",
    )
    const hooks = await LifecycleHooks.loadProjectHooks(dir, true)
    expect(hooks.map((h) => h.event)).toEqual([
      "UserPromptSubmit",
      "PreCompact",
      "SubagentStop",
      "SessionStart",
      "SessionEnd",
      "PostCompact",
      "Interrupt",
    ])
  })

  test("rejects malformed project hook entries instead of trusting parsed JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-hooks-invalid-"))
    await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".ax-code", "hooks.json"),
      JSON.stringify({ hooks: [{ event: "NotAnEvent", command: 42 }] }),
      "utf8",
    )

    await expect(LifecycleHooks.loadProjectHooks(dir, true)).resolves.toEqual([])
  })
})

describe("LifecycleHooks claude-code wire protocol", () => {
  test("exit 2 with permissionDecision deny blocks with the structured reason", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'deny',reason:'no force pushes'}));process.exit(2)"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: { command: "git push --force" }, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.blockReason).toBe("no force pushes")
  })

  test("exit 2 with plain stderr blocks and surfaces stderr as the reason", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.error('blocked by policy');process.exit(2)"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("blocked by policy")
  })

  test("exit 2 with malformed stdout JSON still blocks (fail-safe)", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log('{not json');console.error('boom');process.exit(2)"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("boom")
  })

  test("exit 0 with permissionDecision allow proceeds", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'allow'}))"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(false)
    expect(result.ok).toBe(true)
  })

  test("exit 0 with permissionDecision deny blocks with reason", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "UserPromptSubmit",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'deny',reason:'prompt rejected'}))"`,
        },
      ],
      { event: "UserPromptSubmit", args: { prompt: "hi" }, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("prompt rejected")
  })

  test("permissionDecision ask degrades to a fail-safe block", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'ask'}))"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("hook requested user confirmation")
  })

  test("exit 1 is a non-blocking error for protocol entries", async () => {
    const result = await LifecycleHooks.runHooks(
      [{ event: "PreToolUse", protocol: "claude-code", command: "exit 1" }],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(false)
  })

  test("protocol unset keeps legacy behavior byte-identical", async () => {
    // Exit 2 without blockOnFailure must not block (legacy fail-open).
    const legacy = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'deny',reason:'x'}));process.exit(2)"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(legacy.blocked).toBe(false)
    expect(legacy.blockReason).toBeUndefined()

    // Exit 2 with blockOnFailure still blocks, with no decoder reason.
    const blocking = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          blockOnFailure: true,
          command: `node -e "console.error('legacy block');process.exit(2)"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(blocking.blocked).toBe(true)
    expect(blocking.blockReason).toBeUndefined()
  })

  test("observation-only events ignore the decoder even with exit 2", async () => {
    for (const event of ["PostToolUse", "Stop", "SessionStart", "Interrupt"] as const) {
      const result = await LifecycleHooks.runHooks(
        [
          {
            event,
            protocol: "claude-code",
            command: `node -e "console.log(JSON.stringify({permissionDecision:'deny',reason:'x'}));process.exit(2)"`,
          },
        ],
        { event, cwd: process.cwd() },
      )
      expect(result.blocked).toBe(false)
      expect(result.ok).toBe(true)
    }
  })

  test("loads protocol entries from .ax-code/hooks.json", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-hooks-proto-"))
    await fs.mkdir(path.join(dir, ".ax-code"), { recursive: true })
    await fs.writeFile(
      path.join(dir, ".ax-code", "hooks.json"),
      JSON.stringify({
        hooks: [{ event: "PreToolUse", matcher: "bash", command: "true", protocol: "claude-code" }],
      }),
      "utf8",
    )
    const hooks = await LifecycleHooks.loadProjectHooks(dir, true)
    expect(hooks).toHaveLength(1)
    expect(hooks[0]?.protocol).toBe("claude-code")
  })
})

describe("LifecycleHooks session lifecycle firing sites", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function spyOnRun() {
    return vi.spyOn(LifecycleHooks, "runForWorkspace").mockResolvedValue({ ok: true, blocked: false, outputs: [] })
  }

  // Firing sites are fire-and-forget, so poll until the fire-and-forget
  // promise chain reaches the spy with the expected event.
  async function waitForEvent(spy: ReturnType<typeof spyOnRun>, event: string) {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const call = spy.mock.calls.map((c) => c[0]).find((c) => c.event === event)
      if (call) return call
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return undefined
  }

  test("Session.create fires SessionStart with id/title/time only for top-level sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOnRun()
        const session = await Session.create({ title: "Hook Test" })
        const call = await waitForEvent(spy, "SessionStart")

        expect(call).toBeDefined()
        expect(call?.sessionID).toBe(session.id)
        // Payload carries ids/title/timestamp only — no conversation text.
        expect(call?.args).toEqual({
          sessionID: session.id,
          title: "Hook Test",
          time: session.time.created,
        })

        // Subagent (child) sessions do not fire SessionStart — they surface
        // via SubagentStop instead.
        spy.mockClear()
        await Session.create({ parentID: session.id, title: "Child" })
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(spy).not.toHaveBeenCalled()
      },
    })
  })

  test("Session.setArchived fires SessionEnd with reason archive", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOnRun()
        const session = await Session.create({})
        // Flush the pending fire-and-forget SessionStart from create().
        await waitForEvent(spy, "SessionStart")
        spy.mockClear()

        await Session.setArchived({ sessionID: session.id, time: Date.now() })
        const call = await waitForEvent(spy, "SessionEnd")

        expect(call).toBeDefined()
        expect(call?.sessionID).toBe(session.id)
        expect(call?.args).toEqual({ sessionID: session.id, reason: "archive" })

        // Unarchiving (time null) is not a session end.
        spy.mockClear()
        await Session.setArchived({ sessionID: session.id, time: null })
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(spy).not.toHaveBeenCalled()
      },
    })
  })

  test("Session.remove fires SessionEnd with reason remove", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOnRun()
        const session = await Session.create({})
        // Flush the pending fire-and-forget SessionStart from create().
        await waitForEvent(spy, "SessionStart")
        spy.mockClear()

        await Session.remove(session.id)
        const call = await waitForEvent(spy, "SessionEnd")

        expect(call).toBeDefined()
        expect(call?.sessionID).toBe(session.id)
        expect(call?.args).toEqual({ sessionID: session.id, reason: "remove" })
      },
    })
  })

  test("SessionPrompt.cancel without the interrupt flag does not fire Interrupt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOnRun()
        const session = await Session.create({})
        await waitForEvent(spy, "SessionStart")
        spy.mockClear()

        // Internal/cleanup callers (prompt-loop drain, Session.remove
        // cascade, error teardown) call cancel() without the flag — a normal
        // turn end must not surface as a user Interrupt.
        await SessionPrompt.cancel(session.id)
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(spy.mock.calls.map((c) => c[0].event)).not.toContain("Interrupt")
      },
    })
  })

  test("SessionPrompt.cancel with { interrupt: true } fires Interrupt exactly once", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOnRun()
        const session = await Session.create({})
        await waitForEvent(spy, "SessionStart")
        spy.mockClear()

        await SessionPrompt.cancel(session.id, { interrupt: true })
        const call = await waitForEvent(spy, "Interrupt")

        expect(call).toBeDefined()
        expect(call?.sessionID).toBe(session.id)
        expect(call?.args).toEqual({ sessionID: session.id })
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(spy.mock.calls.filter((c) => c[0].event === "Interrupt")).toHaveLength(1)
      },
    })
  })

  test("Session.remove does not fire Interrupt for the removed session or its descendants", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const spy = spyOnRun()
        const parent = await Session.create({})
        await Session.create({ parentID: parent.id })
        await waitForEvent(spy, "SessionStart")
        spy.mockClear()

        await Session.remove(parent.id)
        await waitForEvent(spy, "SessionEnd")
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(spy.mock.calls.map((c) => c[0].event)).not.toContain("Interrupt")
      },
    })
  })
})
