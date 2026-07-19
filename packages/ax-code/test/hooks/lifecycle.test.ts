import { describe, expect, test } from "vitest"
import { LifecycleHooks } from "../../src/hooks/lifecycle"
import fs from "fs/promises"
import os from "os"
import path from "path"

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
