import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { effectiveInputForApproval, hookRewriteApproval, rewriteRecordValue } from "../../src/hooks/input-rewrite"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const hook = (value: unknown, exit = 0): LifecycleHooks.HookCommand => ({
  event: "PreToolUse",
  protocol: "claude-code",
  command: `node -e 'process.stdout.write(${JSON.stringify(JSON.stringify(value))});process.exit(${exit})'`,
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

describe("hook input rewrite", () => {
  test.each([
    [{ updatedInput: { command: "pwd" } }, { command: "pwd" }],
    [{ hookSpecificOutput: { updatedInput: { command: "pwd" } } }, { command: "pwd" }],
    [{ updatedInput: {}, hookSpecificOutput: { updatedInput: { ignored: true } } }, {}],
    [{ updatedInput: [], permissionDecision: "allow" }, undefined],
    [{ updatedInput: null }, undefined],
    [{ updatedInput: "wrong" }, undefined],
    [{ updatedInput: 1 }, undefined],
    [[], undefined],
    [null, undefined],
    [{ updatedInput: { command: "pwd" }, reason: null }, { command: "pwd" }],
    [{ updatedInput: { command: "pwd" }, permissionDecision: "deny" }, undefined],
    [{ updatedInput: { command: "pwd" }, decision: "block" }, undefined],
  ])("decodes independently: %j", (value, expected) => {
    expect(
      LifecycleHooks.decodeClaudeCodeDecision({ command: "node", stdout: JSON.stringify(value), stderr: "", exit: 0 })
        .updatedInput,
    ).toEqual(expected)
  })

  test.each([1, 2, 124])("ignores rewrites on exit %i", (exit) => {
    expect(
      LifecycleHooks.decodeClaudeCodeDecision({
        command: "node",
        stdout: JSON.stringify({ updatedInput: {} }),
        stderr: "",
        exit,
      }).updatedInput,
    ).toBeUndefined()
  })

  test("keeps the last of three rewrites, feeds it to later hooks, and strips command arguments", async () => {
    const hooks = [1, 2, 3, 4].map((n) => hook({ updatedInput: { n } }))
    hooks.push({ event: "PreToolUse", command: "node -e 'process.stdout.write(process.env.HOOK_ARGS_JSON)'" })
    const result = await LifecycleHooks.runHooks(hooks, { event: "PreToolUse", args: { n: 0 } })
    expect(result.rewrite).toEqual({ updatedInput: { n: 3 }, hooks: ["node", "node", "node"] })
    expect(result.outputs.at(-1)?.stdout).toBe('{"n":3}')
  })

  test.each([
    hook({ permissionDecision: "deny" }),
    hook({}, 2),
    { event: "PreToolUse" as const, command: "exit 1", blockOnFailure: true },
  ])("a later block discards all rewrites", async (deny) => {
    const result = await LifecycleHooks.runHooks([hook({ updatedInput: {} }), deny], { event: "PreToolUse" })
    expect(result.blocked).toBe(true)
    expect(result.rewrite).toBeUndefined()
  })

  test.each(["PostToolUse", "PostToolUseFailure", "PermissionRequest", "SessionStart", "UserPromptSubmit"] as const)(
    "%s ignores updatedInput",
    async (event) => {
      const result = await LifecycleHooks.runHooks([{ ...hook({ updatedInput: {} }), event }], { event })
      expect(result.rewrite).toBeUndefined()
    },
  )

  test("legacy hooks and disabled rewrites cannot replace input", async () => {
    const candidate = hook({ updatedInput: {} })
    expect(
      (await LifecycleHooks.runHooks([{ ...candidate, protocol: undefined }], { event: "PreToolUse" })).rewrite,
    ).toBeUndefined()
    expect(
      (await LifecycleHooks.runHooks([candidate], { event: "PreToolUse", allowInputRewrite: false })).rewrite,
    ).toBeUndefined()
  })

  test("ask and rewrite coexist", async () => {
    const result = await LifecycleHooks.runHooks([hook({ permissionDecision: "ask", updatedInput: {} })], {
      event: "PreToolUse",
    })
    expect(result.ask).toBeDefined()
    expect(result.rewrite?.updatedInput).toEqual({})
  })

  test("untrusted project hooks never run or rewrite", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "0")
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".ax-code"))
    await fs.writeFile(
      path.join(tmp.path, ".ax-code/hooks.json"),
      JSON.stringify({ hooks: [hook({ updatedInput: {} })] }),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await LifecycleHooks.runForWorkspace({ event: "PreToolUse" })
        expect(result.outputs).toEqual([])
        expect(result.rewrite).toBeUndefined()
      },
    })
  })

  test("managed false wins over project, inline and later managed true", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    vi.stubEnv("AX_CODE_CONFIG_CONTENT", JSON.stringify({ hooks: { allow_input_rewrite: true } }))
    await using managed = await tmpdir()
    await using project = await tmpdir({ config: { hooks: { allow_input_rewrite: true } } })
    await fs.writeFile(
      path.join(managed.path, "ax-code.json"),
      JSON.stringify({ hooks: { allow_input_rewrite: false } }),
    )
    await fs.writeFile(
      path.join(managed.path, "ax-code.jsonc"),
      JSON.stringify({ hooks: { allow_input_rewrite: true } }),
    )
    await fs.mkdir(path.join(project.path, ".ax-code"))
    await fs.writeFile(
      path.join(project.path, ".ax-code/hooks.json"),
      JSON.stringify({ hooks: [hook({ updatedInput: {} })] }),
    )
    const previous = Config.managedConfigDir()
    Config.__setTestManagedConfigDir(managed.path)
    try {
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          expect((await Config.get()).hooks?.allow_input_rewrite).toBe(false)
          expect((await LifecycleHooks.runForWorkspace({ event: "PreToolUse" })).rewrite).toBeUndefined()
        },
      })
    } finally {
      Config.__setTestManagedConfigDir(previous)
    }
  })

  test("audit redacts structured and free-text credentials before a 4 KiB byte cap", () => {
    const secret = ["sk", "-", "a".repeat(40)].join("")
    const text = rewriteRecordValue({
      password: "hidden-value",
      nested: { authorization: secret },
      command: `echo ${secret}`,
    })
    expect(text).not.toContain(secret)
    expect(text).not.toContain("hidden-value")
    const capped = rewriteRecordValue({ content: "\u00e9".repeat(4096), password: secret })
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(4096)
    expect(capped).toContain("[truncated]")
  })
})

test("approval copies bound every object, array, string and nesting level", () => {
  const wide = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`field${i}`, "x".repeat(2100)]))
  const result = effectiveInputForApproval({
    wide,
    list: Array.from({ length: 25 }, () => ({ text: "y".repeat(2100) })),
    deep: { a: { b: { c: { password: ["value", "hidden"].join("-") } } } },
  })
  expect(Object.keys(result.wide as object)).toHaveLength(40)
  expect(Object.values(result.wide as object).every((value) => value.length === 2000)).toBe(true)
  expect(result.list).toHaveLength(20)
  expect((result.list as { text: string }[]).every((entry) => entry.text.length === 2000)).toBe(true)
  expect(result.deep).toEqual({ a: { b: { c: "[truncated]" } } })
  expect(Object.keys(effectiveInputForApproval(wide))).toHaveLength(40)
})

test("changed fields include removed values and deep differences before display limits", () => {
  const original = { removed: true, same: { a: 1, b: 2 }, long: "x".repeat(2000) + "a" }
  const effective = { added: true, same: { b: 2, a: 1 }, long: "x".repeat(2000) + "b" }
  expect(hookRewriteApproval(original, effective).changedFields).toEqual(["removed", "long", "added"])
})
