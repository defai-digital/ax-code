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

  test.each([
    ["git push -uf origin HEAD", true],
    ["git push -fv origin HEAD", true],
    ["git -C /repo push --force", true],
    ["git push --force-with-lease origin main", true],
    ["git push origin +HEAD:main", true],
    ["cd repo && git push -f", true],
    ["git push -u origin feature", false],
    ["git fetch -f origin", false],
    ["git push origin main && echo +done", false],
    ['git push "--force" origin main', true],
    ["sh -c 'git push --force origin main'", true],
    ["git -C push log -f", false],
    ["git --git-dir .git push -f", true],
    ["(git push --force)", true],
    ["echo $(git push -f)", true],
    ['git -C "my repo" push --force', true],
    ["git --super-prefix pref push --force", true],
    ["C:\\Git\\bin\\git.exe push --force", true],
    ['git push "a;b" --force', true],
  ])("block-force-push decides %s", async (command, expected) => {
    const hooks = LifecycleHooks.listBuiltinPacks().find((p) => p.name === "block-force-push")!.hooks
    const result = await LifecycleHooks.runHooks(hooks, {
      event: "PreToolUse",
      tool: "bash",
      args: { command },
      cwd: process.cwd(),
    })
    expect(result.blocked).toBe(expected)
  })

  test("an out-of-range hook timeout falls back to the default instead of firing at once", async () => {
    vi.stubEnv("AX_CODE_HOOK_TIMEOUT_MS", "3000000000")
    try {
      const result = await LifecycleHooks.runHooks(
        [{ event: "PreToolUse", command: 'node -e "setTimeout(()=>process.exit(0),200)"', blockOnFailure: true }],
        { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
      )
      expect(result.blocked).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
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

  test("captures multi-byte output that straddles a pipe chunk boundary without loss", async () => {
    // 30,000 x U+4F60 (3 UTF-8 bytes each) = 90,000 bytes, so a 64 KiB pipe
    // chunk boundary lands mid-character (65536 % 3 != 0).
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          command: `node -e "process.stdout.write('\\u4f60'.repeat(30000))"`,
        },
      ],
      {
        event: "PreToolUse",
        args: { command: "echo hi" },
      },
    )

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout).toBe("\u4f60".repeat(30000))
  })

  test("a stray invalid UTF-8 byte does not wedge the captured stream", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          command: `node -e "process.stdout.write(Buffer.concat([Buffer.from([0xff]), Buffer.from('after')]))"`,
        },
      ],
      {
        event: "PreToolUse",
        args: { command: "echo hi" },
      },
    )

    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout).toContain("after")
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
      "PermissionRequest",
      "StopFailure",
      "Notification",
    ] as const) {
      const result = await LifecycleHooks.runHooks([{ event, blockOnFailure: true, command: "exit 2" }], {
        event,
        cwd: process.cwd(),
      })
      expect(result.blocked).toBe(false)
    }
  })

  test("ADR-259 observation events are fail-open under the claude-code protocol too", async () => {
    // A hook that answers deny (exit 2) on PermissionRequest/StopFailure/
    // Notification must not block or veto anything: observation-only.
    for (const event of ["PermissionRequest", "StopFailure", "Notification"] as const) {
      const result = await LifecycleHooks.runHooks(
        [{ event, protocol: "claude-code", blockOnFailure: true, command: "exit 2" }],
        { event, tool: "bash", args: { sessionID: "s1" }, cwd: process.cwd() },
      )
      expect(result.blocked).toBe(false)
      expect(result.ok).toBe(true)
    }
  })

  test("a PermissionRequest hook receives the payload but never tool arguments", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PermissionRequest" as const,
          command:
            "node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const a=JSON.parse(s);process.stdout.write(JSON.stringify({permission:a.permission,hasArgs:'command' in a}))})\"",
        },
      ],
      {
        event: "PermissionRequest",
        tool: "bash",
        // Mirrors the payload the permission gate sends: no tool arguments.
        args: { sessionID: "s1", permission: "bash", patterns: ["git push"], riskClass: "risk" },
        cwd: process.cwd(),
      },
    )
    expect(result.outputs[0]?.exit).toBe(0)
    expect(JSON.parse(result.outputs[0]!.stdout)).toEqual({ permission: "bash", hasArgs: false })
  })

  test("a hook that cannot be spawned is a failed run, not a broken gate", async () => {
    // A NUL byte in the command makes spawn throw synchronously. It must be
    // reported as the failed run it is: the tool gate swallows a *thrown* hook
    // failure, so letting it escape would drop the confirmation the previous
    // hook already asked for and let the tool through.
    const confirming = {
      event: "PreToolUse",
      matcher: "bash",
      protocol: "claude-code",
      command: `printf '%s' '{"permissionDecision":"ask","reason":"confirm the push"}'`,
    } as const

    const soft = await LifecycleHooks.runHooks(
      [confirming, { event: "PreToolUse", matcher: "bash", command: "exit 2\u0000" }],
      { event: "PreToolUse", tool: "bash", args: { command: "git push origin main" }, cwd: process.cwd() },
    )
    expect(soft.blocked).toBe(false)
    expect(soft.ask).toMatchObject({ reason: "confirm the push" })
    expect(soft.outputs.at(-1)?.exit).not.toBe(0)

    const hard = await LifecycleHooks.runHooks(
      [confirming, { event: "PreToolUse", matcher: "bash", blockOnFailure: true, command: "exit 2\u0000" }],
      { event: "PreToolUse", tool: "bash", args: { command: "git push origin main" }, cwd: process.cwd() },
    )
    expect(hard.blocked).toBe(true)
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
          { event: "PermissionRequest", command: "true" },
          { event: "StopFailure", command: "true" },
          { event: "Notification", command: "true" },
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
      "PermissionRequest",
      "StopFailure",
      "Notification",
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

  test("exit 0 with a top-level decision block blocks a PreToolUse", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({decision:'block',reason:'policy says no'}))"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("policy says no")
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

  test("exit 0 with deny and an ill-typed sibling field still blocks", async () => {
    // A type-invalid optional field (e.g. a serialized absent reason) must not
    // discard a valid deny verdict — that turned the hook fail-open.
    const cases = [
      `{permissionDecision:'deny',reason:42}`,
      `{permissionDecision:'deny',reason:null}`,
      `{permissionDecision:'deny',hookSpecificOutput:null}`,
    ]
    for (const objectLiteral of cases) {
      const result = await LifecycleHooks.runHooks(
        [
          {
            event: "PreToolUse",
            protocol: "claude-code",
            command: `node -e "console.log(JSON.stringify(${objectLiteral}))"`,
          },
        ],
        { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
      )
      expect(result.blocked).toBe(true)
    }
  })

  test("permissionDecision ask is surfaced for interactive confirmation instead of blocking", async () => {
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
    expect(result.blocked).toBe(false)
    expect(result.ok).toBe(true)
    expect(result.ask).toEqual({ reason: "hook requested user confirmation" })
  })

  test("UserPromptSubmit ask blocks because the event has no permission channel", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "UserPromptSubmit",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'ask', reason:'confirm prompt'}))"`,
        },
      ],
      { event: "UserPromptSubmit", args: { prompt: "hi" }, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("confirm prompt")
    expect(result.ask).toBeUndefined()
  })

  test("a later deny wins over an earlier ask", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'ask', reason:'confirm first'}))"`,
        },
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e "console.log(JSON.stringify({permissionDecision:'deny', reason:'policy'}))"`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(true)
    expect(result.blockReason).toBe("policy")
    expect(result.ask).toBeUndefined()
  })

  test("accepts the nested Claude Code hookSpecificOutput decision shape", async () => {
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "nested reason",
      },
    })
    const direct = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          protocol: "claude-code",
          command: `node -e 'console.log(JSON.stringify(${JSON.stringify(JSON.parse(payload))}))'`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: {}, cwd: process.cwd() },
    )
    expect(direct.blocked).toBe(true)
    expect(direct.blockReason).toBe("nested reason")
  })
})

describe("LifecycleHooks PostToolUse feedback", () => {
  test("legacy PostToolUse stdout becomes bounded model-visible feedback", async () => {
    const result = await LifecycleHooks.runHooks(
      [
        { event: "PostToolUse", command: `echo "run the formatter"` },
        { event: "PostToolUse", command: `echo "   "` },
        { event: "PostToolUse", command: `echo "second hook"` },
      ],
      { event: "PostToolUse", tool: "edit", args: {}, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(false)
    expect(result.feedback).toBe("run the formatter\n\nsecond hook")
  })

  test("the builtin format-after-edit pack now reaches the model", async () => {
    const hooks = LifecycleHooks.listBuiltinPacks().find((p) => p.name === "format-after-edit")!.hooks
    const result = await LifecycleHooks.runHooks(hooks, {
      event: "PostToolUse",
      tool: "edit",
      args: {},
      cwd: process.cwd(),
    })
    expect(result.feedback).toContain("[hook:format-after-edit]")
  })

  test("claude-code PostToolUse additionalContext, block reason, and exit-2 stderr are feedback", async () => {
    const context = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "lint passed" },
    })
    const block = JSON.stringify({ decision: "block", reason: "tests failed: 2 assertions" })
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PostToolUse",
          protocol: "claude-code",
          command: `node -e 'console.log(JSON.stringify(${JSON.stringify(JSON.parse(context))}))'`,
        },
        {
          event: "PostToolUse",
          protocol: "claude-code",
          command: `node -e 'console.log(JSON.stringify(${JSON.stringify(JSON.parse(block))}))'`,
        },
        {
          event: "PostToolUse",
          protocol: "claude-code",
          command: `node -e "console.error('formatter changed 3 files');process.exit(2)"`,
        },
        // Non-zero exits other than 2 contribute nothing.
        { event: "PostToolUse", protocol: "claude-code", command: `node -e "console.log('noise');process.exit(1)"` },
      ],
      { event: "PostToolUse", tool: "edit", args: {}, cwd: process.cwd() },
    )
    // PostToolUse is not blockable even under the protocol decoder.
    expect(result.blocked).toBe(false)
    expect(result.feedback).toBe("lint passed\n\ntests failed: 2 assertions\n\nformatter changed 3 files")
  })

  test("feedback is bounded per hook and in aggregate", async () => {
    const big = `node -e "process.stdout.write('x'.repeat(5000))"`
    const result = await LifecycleHooks.runHooks(
      [
        { event: "PostToolUse", command: big },
        { event: "PostToolUse", command: big },
        { event: "PostToolUse", command: big },
      ],
      { event: "PostToolUse", tool: "edit", args: {}, cwd: process.cwd() },
    )
    expect(result.feedback).toBeDefined()
    expect(result.feedback!.length).toBeLessThanOrEqual(8_000)
    expect(result.feedback).toContain("[hook feedback truncated to 4000 characters]")
  })

  test("PreToolUse hooks never produce feedback", async () => {
    const result = await LifecycleHooks.runHooks([{ event: "PreToolUse", command: `echo "ignored"` }], {
      event: "PreToolUse",
      tool: "edit",
      args: {},
      cwd: process.cwd(),
    })
    expect(result.feedback).toBeUndefined()
  })

  test("PostToolUseFailure is an accepted observation-only event", async () => {
    const result = await LifecycleHooks.runHooks(
      [{ event: "PostToolUseFailure", command: "exit 2", blockOnFailure: true, protocol: "claude-code" }],
      { event: "PostToolUseFailure", tool: "bash", args: { error: "boom" }, cwd: process.cwd() },
    )
    expect(result.blocked).toBe(false)
    expect(result.ok).toBe(true)
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

describe("LifecycleHooks hook timeout", () => {
  test("a shell still running at the deadline is a real timeout (124) and keeps blocking", async () => {
    vi.stubEnv("AX_CODE_HOOK_TIMEOUT_MS", "300")
    // No background trick here: the shell itself never exits before the
    // deadline. It must settle as 124, and blockOnFailure must keep vetoing.
    const started = Date.now()
    const result = await LifecycleHooks.runHooks(
      [{ event: "PreToolUse", matcher: "bash", blockOnFailure: true, command: "sleep 5" }],
      { event: "PreToolUse", tool: "bash", args: { command: "echo hi" }, cwd: process.cwd() },
    )
    expect(result.outputs[0]?.exit).toBe(124)
    expect(result.blocked).toBe(true)
    expect(Date.now() - started).toBeLessThan(3000)
  }, 20000)

  test("settles without hanging when a detached descendant keeps the pipes open", async () => {
    vi.stubEnv("AX_CODE_HOOK_TIMEOUT_MS", "1500")
    // `shell: true` runs this through sh; the launched node exits 0, but it
    // leaves a detached grandchild (its own process group, so the group kill
    // misses it) inheriting stdout for 6s. The shell actually exited 0, so
    // the run now settles through the post-exit drain grace with the real
    // status instead of the fake 124 the deadline-only path used to report;
    // the assertion that still matters is that a never-closing pipe cannot
    // hang the hook promise — or the slot runHook holds in its finally.
    const command =
      `node -e "const {spawn}=require('node:child_process');` +
      `const c=spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],{stdio:'inherit',detached:true});` +
      `c.unref()"`
    const started = Date.now()
    const result = await LifecycleHooks.runHooks([{ event: "PostToolUse", command }], {
      event: "PostToolUse",
      tool: "bash",
      args: {},
      cwd: process.cwd(),
    })
    expect(result.outputs[0]?.exit).toBe(0)
    expect(Date.now() - started).toBeLessThan(3000)
  }, 20000)

  test("reports the real exit status when a background job holds the pipes open", async () => {
    vi.stubEnv("AX_CODE_HOOK_TIMEOUT_MS", "1500")
    // The shell exits 0 at once, but the backgrounded sleep inherits stdout
    // for 5s, so 'close' cannot fire before the deadline. The real status
    // (and the stdout captured so far) must win over a fake 124, and a
    // blockOnFailure hook must not see a phantom failure.
    const started = Date.now()
    const result = await LifecycleHooks.runHooks(
      [{ event: "PreToolUse", matcher: "bash", blockOnFailure: true, command: "sleep 5 & echo started; exit 0" }],
      { event: "PreToolUse", tool: "bash", args: { command: "echo hi" }, cwd: process.cwd() },
    )
    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.outputs[0]?.stdout.trim()).toBe("started")
    expect(result.blocked).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  }, 20000)

  test("keeps a claude-code deny when a background job holds the pipes open", async () => {
    vi.stubEnv("AX_CODE_HOOK_TIMEOUT_MS", "1500")
    // Regression (security): exit 0 with a stdout deny, but the pipes are
    // held open by a background sleep. Settling as a fake 124 treated the
    // deny as "any other exit" and dropped it — fail-open. The deny must
    // survive with the real exit status.
    const result = await LifecycleHooks.runHooks(
      [
        {
          event: "PreToolUse",
          matcher: "bash",
          protocol: "claude-code",
          command: `sleep 5 & echo '{"permissionDecision":"deny","reason":"policy denies this"}'; exit 0`,
        },
      ],
      { event: "PreToolUse", tool: "bash", args: { command: "rm -rf tmp" }, cwd: process.cwd() },
    )
    expect(result.outputs[0]?.exit).toBe(0)
    expect(result.blocked).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.blockReason).toBe("policy denies this")
  }, 20000)
})
