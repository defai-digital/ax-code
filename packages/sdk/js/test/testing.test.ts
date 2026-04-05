import { describe, expect, test } from "bun:test"
import { createMockAgent, assertToolSuccess, assertToolFailure } from "../src/testing"

describe("createMockAgent", () => {
  test("run() returns pre-configured replies", async () => {
    const agent = createMockAgent({ replies: ["Hello!", "World!"] })
    const r1 = await agent.run("first")
    expect(r1.text).toBe("Hello!")
    const r2 = await agent.run("second")
    expect(r2.text).toBe("World!")
  })

  test("run() wraps around when replies are exhausted", async () => {
    const agent = createMockAgent({ replies: ["only one"] })
    await agent.run("first")
    const r2 = await agent.run("second")
    expect(r2.text).toBe("only one")
  })

  test("stream() yields text and done events", async () => {
    const agent = createMockAgent({ replies: ["streamed text"] })
    const events = []
    for await (const event of agent.stream("go")) {
      events.push(event)
    }
    expect(events.some((e) => e.type === "text" && e.text === "streamed text")).toBe(true)
    expect(events.some((e) => e.type === "done")).toBe(true)
  })

  test("stream().text() collects the full text", async () => {
    const agent = createMockAgent({ replies: ["collected"] })
    const text = await agent.stream("go").text()
    expect(text).toBe("collected")
  })

  test("stream().result() returns a RunResult", async () => {
    const agent = createMockAgent({ replies: ["result text"] })
    const result = await agent.stream("go").result()
    expect(result.text).toBe("result text")
    expect(result.agent).toBe("mock")
  })

  test("tool calls are included in results", async () => {
    const agent = createMockAgent({
      replies: ["done"],
      toolCalls: [{ tool: "grep", input: { pattern: "CVE" }, output: "CVE-2025-1234" }],
    })
    const result = await agent.run("scan")
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].tool).toBe("grep")
    expect(result.toolCalls[0].output).toBe("CVE-2025-1234")
  })

  test("tool() returns stub output for configured tools", async () => {
    const agent = createMockAgent({
      replies: ["ok"],
      toolCalls: [{ tool: "deploy", input: {}, output: "deployed" }],
    })
    const result = await agent.tool("deploy")
    expect(result).toBe("deployed")
  })

  test("tool() throws for unconfigured tools", async () => {
    const agent = createMockAgent({ replies: ["ok"] })
    await expect(agent.tool("missing")).rejects.toThrow(/no stub/)
  })

  test("models() returns mock model", async () => {
    const agent = createMockAgent({ replies: ["ok"] })
    const models = await agent.models()
    expect(models).toContain("mock/mock-model")
  })

  test("tools() returns configured tool names", async () => {
    const agent = createMockAgent({
      replies: ["ok"],
      toolCalls: [{ tool: "grep", input: {}, output: "" }],
    })
    expect(await agent.tools()).toEqual(["grep"])
  })

  test("session() returns a working session handle", async () => {
    const agent = createMockAgent({ replies: ["turn 1", "turn 2"] })
    const session = await agent.session()
    expect(typeof session.id).toBe("string")
    const r1 = await session.run("first")
    expect(r1.text).toBe("turn 1")
    const r2 = await session.run("second")
    expect(r2.text).toBe("turn 2")
  })

  test("dispose() is a no-op (doesn't throw)", async () => {
    const agent = createMockAgent({ replies: ["ok"] })
    await agent.dispose()
  })

  test("throws on empty replies array", () => {
    expect(() => createMockAgent({ replies: [] })).toThrow(/at least one reply/)
  })
})

describe("assertToolSuccess / assertToolFailure", () => {
  test("assertToolSuccess finds a successful tool call", () => {
    const agent = createMockAgent({
      replies: ["ok"],
      toolCalls: [{ tool: "bash", input: { command: "ls" }, output: "file.txt" }],
    })
    // Manually build a result
    const result = {
      text: "ok",
      agent: "mock",
      model: { providerID: "mock", modelID: "mock" },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      toolCalls: [{ tool: "bash", input: {}, output: "file.txt", status: "completed" as const }],
      sessionID: "s",
      messageID: "m",
    }
    const call = assertToolSuccess(result, "bash")
    expect(call.output).toBe("file.txt")
  })

  test("assertToolSuccess throws when tool is missing", () => {
    const result = {
      text: "ok",
      agent: "mock",
      model: { providerID: "mock", modelID: "mock" },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      toolCalls: [],
      sessionID: "s",
      messageID: "m",
    }
    expect(() => assertToolSuccess(result, "bash")).toThrow(/Expected a successful call/)
  })

  test("assertToolFailure finds a failed tool call", () => {
    const result = {
      text: "ok",
      agent: "mock",
      model: { providerID: "mock", modelID: "mock" },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      toolCalls: [{ tool: "deploy", input: {}, output: "error", status: "error" as const }],
      sessionID: "s",
      messageID: "m",
    }
    const call = assertToolFailure(result, "deploy")
    expect(call.output).toBe("error")
  })
})
