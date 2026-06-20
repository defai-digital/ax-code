import { describe, expect, test } from "vitest"
import { createMockAgent } from "../src/testing"

describe("StreamHandle.on() callbacks", () => {
  test("on('text') fires when stream is consumed via done()", async () => {
    const agent = createMockAgent({ replies: ["hello world"] })
    const collected: string[] = []
    const stream = agent.stream("go")
    stream.on("text", (t) => collected.push(t))
    await stream.done()
    expect(collected).toEqual(["hello world"])
  })

  test("on('done') fires with RunResult when stream completes", async () => {
    const agent = createMockAgent({ replies: ["final answer"] })
    let fired = false
    const stream = agent.stream("go")
    stream.on("done", (result) => {
      fired = true
      expect(result.text).toBe("final answer")
      expect(result.agent).toBe("mock")
    })
    await stream.done()
    expect(fired).toBe(true)
  })

  test("on('tool-call') fires for each tool call", async () => {
    const agent = createMockAgent({
      replies: ["done"],
      toolCalls: [
        { tool: "grep", input: { pattern: "TODO" }, output: "found 3" },
        { tool: "bash", input: { command: "ls" }, output: "a.ts" },
      ],
    })
    const called: string[] = []
    const stream = agent.stream("go")
    stream.on("tool-call", (tool) => called.push(tool))
    await stream.done()
    expect(called).toEqual(["grep", "bash"])
  })

  test("on('tool-result') fires for each tool result", async () => {
    const agent = createMockAgent({
      replies: ["done"],
      toolCalls: [{ tool: "read", input: { path: "a.ts" }, output: "file contents" }],
    })
    const results: Array<{ tool: string; output: string }> = []
    const stream = agent.stream("go")
    stream.on("tool-result", (tool, output) => results.push({ tool, output }))
    await stream.done()
    expect(results).toEqual([{ tool: "read", output: "file contents" }])
  })

  test("on() returns the handle for chaining", async () => {
    const agent = createMockAgent({ replies: ["hi"] })
    const stream = agent.stream("go")
    const chained = stream.on("text", () => {}).on("done", () => {})
    expect(chained).toBe(stream)
  })

  test("multiple callbacks for the same event all fire", async () => {
    const agent = createMockAgent({ replies: ["multi"] })
    const log: number[] = []
    const stream = agent.stream("go")
    stream.on("text", () => log.push(1))
    stream.on("text", () => log.push(2))
    await stream.done()
    expect(log).toEqual([1, 2])
  })
})

describe("StreamHandle.cancel()", () => {
  test("cancel() stops iteration before any events fire", async () => {
    const agent = createMockAgent({ replies: ["should not see this"] })
    const stream = agent.stream("go")
    stream.cancel()
    const events = []
    for await (const event of stream) {
      events.push(event)
    }
    expect(events).toHaveLength(0)
  })

  test("cancel() prevents done-callback from firing", async () => {
    const agent = createMockAgent({ replies: ["cancelled"] })
    let doneFired = false
    const stream = agent.stream("go")
    stream.on("done", () => {
      doneFired = true
    })
    stream.cancel()
    await stream.done()
    expect(doneFired).toBe(false)
  })

  test("cancel() can be called multiple times safely", () => {
    const agent = createMockAgent({ replies: ["ok"] })
    const stream = agent.stream("go")
    expect(() => {
      stream.cancel()
      stream.cancel()
    }).not.toThrow()
  })
})

describe("StreamHandle.done()", () => {
  test("done() resolves after all events are yielded", async () => {
    const agent = createMockAgent({ replies: ["complete"] })
    const stream = agent.stream("go")
    let textSeen = false
    stream.on("text", () => {
      textSeen = true
    })
    await stream.done()
    expect(textSeen).toBe(true)
  })

  test("done() on session stream works the same way", async () => {
    const agent = createMockAgent({ replies: ["session text"] })
    const session = await agent.session()
    const collected: string[] = []
    const stream = session.stream("go")
    stream.on("text", (t) => collected.push(t))
    await stream.done()
    expect(collected).toEqual(["session text"])
  })
})
