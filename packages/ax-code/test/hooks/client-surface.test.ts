import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Bus } from "../../src/bus"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// ADR-211: the read-only workspace view and the redacted hook.completed event.

afterEach(() => Instance.disposeAll())

type Completed = Parameters<Parameters<typeof Bus.subscribe<typeof LifecycleHooks.Event.Completed>>[1]>[0]["properties"]

async function collectCompleted(directory: string, run: () => Promise<unknown>): Promise<Completed[]> {
  const events: Completed[] = []
  await Instance.provide({
    directory,
    fn: async () => {
      const unsubscribe = Bus.subscribe(LifecycleHooks.Event.Completed, (event) => {
        events.push(event.properties)
      })
      await run()
      await new Promise((resolve) => setTimeout(resolve, 0))
      unsubscribe()
    },
  })
  return events
}

describe("hook.completed", () => {
  test("publishes one redacted event per executed entry with its outcome", async () => {
    await using tmp = await tmpdir({ git: true })
    const hooks: LifecycleHooks.HookCommand[] = [
      // The printed text is assembled at run time, so it can only reach the
      // event through captured output, never through the command string.
      { event: "PreToolUse", matcher: "bash", command: "printf 'stdout-%s' marker; exit 0" },
      { event: "PreToolUse", matcher: "bash", command: "printf 'stderr-%s' marker >&2; exit 3" },
      { event: "PreToolUse", matcher: "bash", command: "exit 4", blockOnFailure: true, pack: "guard" },
      { event: "PreToolUse", matcher: "bash", command: "echo never-runs" },
    ]
    const events = await collectCompleted(tmp.path, () =>
      LifecycleHooks.runHooks(hooks, {
        event: "PreToolUse",
        tool: "bash",
        sessionID: "ses_hooks_events",
        args: { command: "rm -rf /tmp/x" },
        cwd: tmp.path,
      }),
    )

    expect(events.map((event) => [event.outcome, event.exit, event.source])).toEqual([
      ["ok", 0, "project"],
      ["failed", 3, "project"],
      // A project entry that only labels itself with `pack` is still a project hook.
      ["blocked", 4, "project"],
    ])
    expect(events[2]).toMatchObject({ sessionID: "ses_hooks_events", event: "PreToolUse", tool: "bash", pack: "guard" })
    for (const event of events) expect(event.durationMs).toBeGreaterThanOrEqual(0)
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain("stdout-marker")
    expect(serialized).not.toContain("stderr-marker")
    expect(serialized).not.toContain("rm -rf")
  })

  test("reports a claude-code protocol ask and block with the bounded reason", async () => {
    await using tmp = await tmpdir({ git: true })
    const ask = `printf '%s' '{"permissionDecision":"ask","reason":"confirm the deploy"}'`
    const deny = `printf '%s' '{"permissionDecision":"deny","reason":"blocked by policy"}'`
    const events = await collectCompleted(tmp.path, () =>
      LifecycleHooks.runHooks(
        [
          { event: "PreToolUse", command: ask, protocol: "claude-code" },
          { event: "PreToolUse", command: deny, protocol: "claude-code" },
        ],
        { event: "PreToolUse", tool: "bash", cwd: tmp.path },
      ),
    )

    expect(events.map((event) => [event.outcome, event.reason])).toEqual([
      ["ask", "confirm the deploy"],
      ["blocked", "blocked by policy"],
    ])
  })

  test("labels a built-in pack hook as a pack hook", async () => {
    await using tmp = await tmpdir({ git: true })
    const pack = LifecycleHooks.listBuiltinPacks().find((candidate) =>
      candidate.hooks.some((hook) => hook.event === "PostToolUse"),
    )!
    const hook = pack.hooks.find((candidate) => candidate.event === "PostToolUse")!
    const events = await collectCompleted(tmp.path, () =>
      LifecycleHooks.runHooks([hook], { event: "PostToolUse", tool: "edit", cwd: tmp.path }),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ source: "pack", pack: pack.name })
  })

  test("reports PostToolUse feedback hooks and failed observation hooks without their output", async () => {
    await using tmp = await tmpdir({ git: true })
    const feedback = await collectCompleted(tmp.path, () =>
      LifecycleHooks.runHooks([{ event: "PostToolUse", command: "printf 'feedback-%s' marker" }], {
        event: "PostToolUse",
        tool: "edit",
        cwd: tmp.path,
      }),
    )
    expect(feedback.map((event) => event.outcome)).toEqual(["ok"])
    expect(JSON.stringify(feedback)).not.toContain("feedback-marker")

    const stop = await collectCompleted(tmp.path, () =>
      LifecycleHooks.runHooks([{ event: "Stop", command: "exit 5", blockOnFailure: true }], {
        event: "Stop",
        cwd: tmp.path,
      }),
    )
    expect(stop.map((event) => [event.outcome, event.exit])).toEqual([["failed", 5]])
  })

  test("a run outside an instance still returns its gate result", async () => {
    const result = await LifecycleHooks.runHooks(
      [{ event: "UserPromptSubmit", command: "exit 2", blockOnFailure: true }],
      {
        event: "UserPromptSubmit",
      },
    )
    expect(result.blocked).toBe(true)
  })
})

describe("describeWorkspace", () => {
  async function writeHooksFile(directory: string, content: string) {
    await fs.mkdir(path.join(directory, ".ax-code"), { recursive: true })
    await fs.writeFile(path.join(directory, ".ax-code", "hooks.json"), content)
  }

  test("reports a valid but untrusted file without listing its hooks as active", async () => {
    await using tmp = await tmpdir()
    const pack = LifecycleHooks.listBuiltinPacks()[0]
    await writeHooksFile(
      tmp.path,
      JSON.stringify({ packs: [pack.name], hooks: [{ event: "Stop", command: "echo done" }] }),
    )

    const view = await LifecycleHooks.describeWorkspace(tmp.path, false)
    expect(view.trusted).toBe(false)
    expect(view.file).toMatchObject({ exists: true, valid: true })
    expect(view.file.error).toBeUndefined()
    expect(view.hooks).toEqual([])
    expect(view.packs.every((entry) => entry.enabled === false)).toBe(true)
  })

  test("lists pack and project hooks in run order when trusted", async () => {
    await using tmp = await tmpdir()
    const pack = LifecycleHooks.listBuiltinPacks()[0]
    await writeHooksFile(
      tmp.path,
      JSON.stringify({
        packs: [pack.name],
        hooks: [{ event: "PreToolUse", matcher: "bash", command: "./guard.sh", protocol: "claude-code" }],
      }),
    )

    const view = await LifecycleHooks.describeWorkspace(tmp.path, true)
    expect(view.trusted).toBe(true)
    expect(view.hooks.length).toBe(pack.hooks.length + 1)
    expect(view.hooks.slice(0, pack.hooks.length).every((entry) => entry.source === "pack")).toBe(true)
    expect(view.hooks.at(-1)).toEqual({
      event: "PreToolUse",
      matcher: "bash",
      command: "./guard.sh",
      protocol: "claude-code",
      source: "project",
    })
    expect(view.packs.find((entry) => entry.name === pack.name)?.enabled).toBe(true)
  })

  test("reports a project entry with a pack label as a project hook", async () => {
    await using tmp = await tmpdir()
    await writeHooksFile(tmp.path, JSON.stringify({ hooks: [{ event: "Stop", command: "echo hi", pack: "mine" }] }))
    const view = await LifecycleHooks.describeWorkspace(tmp.path, true)
    expect(view.hooks).toEqual([{ event: "Stop", command: "echo hi", source: "project", pack: "mine" }])
  })

  test("explains an unparseable or schema-invalid file", async () => {
    await using tmp = await tmpdir()
    await writeHooksFile(tmp.path, "{ not json")
    const broken = await LifecycleHooks.describeWorkspace(tmp.path, true)
    expect(broken.file).toMatchObject({ exists: true, valid: false })
    expect(broken.file.error).toContain("not valid JSON")
    expect(broken.hooks).toEqual([])

    await writeHooksFile(tmp.path, JSON.stringify({ hooks: [{ event: "NoSuchEvent", command: "x" }] }))
    const invalid = await LifecycleHooks.describeWorkspace(tmp.path, true)
    expect(invalid.file).toMatchObject({ exists: true, valid: false })
    expect(invalid.file.error).toContain("does not match the hook schema")
  })

  test("reports a missing file as absent, not as an error", async () => {
    await using tmp = await tmpdir()
    const view = await LifecycleHooks.describeWorkspace(tmp.path, true)
    expect(view.file).toEqual({ path: path.join(tmp.path, ".ax-code", "hooks.json"), exists: false, valid: false })
    expect(view.hooks).toEqual([])
    expect(view.packs.length).toBeGreaterThan(0)
  })
})
