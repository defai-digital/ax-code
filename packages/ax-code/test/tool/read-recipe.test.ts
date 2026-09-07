import { afterEach, describe, expect, test, vi } from "vitest"
import { ReadRecipeTool } from "../../src/tool/read_recipe"
import { Session } from "../../src/session"
import { SessionID, MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"

function context(dispatcher: Tool.Dispatcher, controller = new AbortController()): Tool.Context {
  return {
    sessionID: SessionID.make("ses_recipe"),
    messageID: MessageID.make("msg_recipe"),
    callID: "recipe_parent",
    agent: "build",
    abort: controller.signal,
    messages: [],
    metadata() {},
    async ask() {},
    extra: { toolDispatcher: dispatcher },
  }
}
afterEach(() => vi.restoreAllMocks())
describe("read-only recipes", () => {
  test("resolves canonical references through the scoped dispatcher and records each child", async () => {
    const recorded = vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part)
    const execute = vi.fn<Tool.Dispatcher["execute"]>(async ({ tool, parameters }) => {
      if (tool === "glob")
        return { title: "files", output: "/tmp/a.ts", metadata: {}, data: { paths: ["/tmp/a.ts"], truncated: false } }
      expect(parameters).toEqual({ filePath: "/tmp/a.ts" })
      return { title: "read", output: "source", metadata: {}, data: { kind: "text", text: "source", truncated: false } }
    })
    const recipe = await ReadRecipeTool.init()
    const result = await recipe.execute(
      {
        steps: [
          { id: "files", tool: "glob", parameters: { pattern: "*.ts" } },
          { id: "source", tool: "read", parameters: { filePath: { $ref: { step: "files", path: ["paths", 0] } } } },
        ],
      },
      context({ ids: ["glob", "read"], execute, concurrencySafe: () => true }),
    )
    expect(execute).toHaveBeenCalledTimes(2)
    expect(recorded).toHaveBeenCalledTimes(4)
    expect(recorded.mock.calls.every(([part]) => part.type === "tool" && part.parentCallID === "recipe_parent")).toBe(
      true,
    )
    expect(result.output).toContain("source")
    expect(result.metadata.recipeProjection).toBe(true)
  })

  test("rejects prototype paths, forward references, recursion and disabled tools before dispatch", async () => {
    const execute = vi.fn<Tool.Dispatcher["execute"]>()
    const ctx = context({ ids: ["read"], execute, concurrencySafe: () => true })
    const recipe = await ReadRecipeTool.init()
    for (const parameters of [{ filePath: { $ref: { step: "future", path: [] } } }, { constructor: "bad" }]) {
      await expect(recipe.execute({ steps: [{ id: "file", tool: "read", parameters }] }, ctx)).rejects.toThrow()
    }
    await expect(recipe.execute({ steps: [{ id: "files", tool: "glob", parameters: {} }] }, ctx)).rejects.toThrow(
      "not enabled",
    )
    expect(
      recipe.parameters.safeParse({ steps: [{ id: "nested", tool: "read_recipe", parameters: {} }] }).success,
    ).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  test("pauses on new repository instructions and preserves the original child projection", async () => {
    vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part)
    const execute = vi.fn<Tool.Dispatcher["execute"]>(async () => ({
      title: "read",
      output: "new instructions",
      metadata: { loaded: ["/repo/AGENTS.md"] },
      data: { kind: "text", text: "new instructions", truncated: false },
    }))
    const recipe = await ReadRecipeTool.init()
    const result = await recipe.execute(
      {
        steps: [
          { id: "one", tool: "read", parameters: {} },
          { id: "two", tool: "read", parameters: {} },
        ],
      },
      context({ ids: ["read"], execute, concurrencySafe: () => true }),
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.metadata).toMatchObject({ status: "paused_for_context", recipeProjection: false })
  })

  test("waits for owned work on abort and rejects malformed canonical output", async () => {
    const recorded = vi.spyOn(Session, "updatePart").mockImplementation(async (part) => part)
    const controller = new AbortController()
    const execute: Tool.Dispatcher["execute"] = async ({ abort }) => {
      controller.abort(new Error("cancelled"))
      abort.throwIfAborted()
      throw new Error("unreachable")
    }
    const recipe = await ReadRecipeTool.init()
    await expect(
      recipe.execute(
        { steps: [{ id: "file", tool: "read", parameters: {} }] },
        context({ ids: ["read"], execute, concurrencySafe: () => true }, controller),
      ),
    ).rejects.toThrow("cancelled")
    expect(recorded.mock.calls.at(-1)?.[0]).toMatchObject({ state: { status: "error" } })
    const result = await recipe.execute(
      { steps: [{ id: "file", tool: "read", parameters: {} }] },
      context({
        ids: ["read"],
        concurrencySafe: () => true,
        async execute() {
          return { title: "bad", output: "looks fine", metadata: {}, data: { forged: true } }
        },
      }),
    )
    expect(result.metadata.status).toBe("error")
  })
})
