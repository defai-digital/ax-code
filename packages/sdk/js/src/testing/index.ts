/**
 * Testing utilities for @ax-code/sdk.
 *
 * Use `createMockAgent` in unit tests to verify your agent integration
 * without calling a real LLM provider. The mock agent satisfies the
 * full `Agent` interface but returns pre-configured replies.
 *
 * @example
 * ```ts
 * import { createMockAgent } from "@ax-code/sdk/testing"
 *
 * test("my bot scans for CVEs", async () => {
 *   const agent = createMockAgent({
 *     replies: ["Found 2 CVEs. Opening PR to bump versions."],
 *     toolCalls: [
 *       { tool: "grep", input: { pattern: "CVE-" }, output: "CVE-2025-1234" },
 *     ],
 *   })
 *   const result = await agent.run("scan for CVEs")
 *   expect(result.text).toContain("2 CVEs")
 *   expect(result.toolCalls).toHaveLength(1)
 * })
 * ```
 */

import type {
  Agent,
  RunOptions,
  RunResult,
  StreamEvent,
  StreamHandle,
  SessionHandle,
  ToolCallInfo,
} from "../programmatic/types.js"

export interface MockAgentOptions {
  /** Pre-configured text replies. Each `run()` / `stream()` call pops
   *  the next reply. Wraps around if calls exceed the array length. */
  replies: string[]
  /** Optional pre-configured tool-call stubs. When the mock agent's
   *  `tool()` method is called with a matching name, it returns the
   *  configured output. Also included in `RunResult.toolCalls`. */
  toolCalls?: Array<{ tool: string; input: unknown; output: string }>
}

function makeMockResult(text: string, toolCalls: ToolCallInfo[]): RunResult {
  return {
    text,
    agent: "mock",
    model: { providerID: "mock", modelID: "mock-model" },
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    toolCalls,
    sessionID: "mock-session",
    messageID: "mock-message",
  }
}

function makeMockStreamHandle(text: string, toolCalls: ToolCallInfo[]): StreamHandle {
  const result = makeMockResult(text, toolCalls)
  const listeners: Record<string, Function[]> = {}

  async function* gen(): AsyncGenerator<StreamEvent> {
    for (const tc of toolCalls) {
      const event: StreamEvent = { type: "tool-call", tool: tc.tool, input: tc.input, id: `tc-${tc.tool}` }
      for (const cb of listeners["tool-call"] ?? []) cb(tc.tool, tc.input)
      yield event
      const resultEvent: StreamEvent = {
        type: "tool-result",
        tool: tc.tool,
        output: tc.output,
        id: `tc-${tc.tool}`,
        status: tc.status,
      }
      for (const cb of listeners["tool-result"] ?? []) cb(tc.tool, tc.output, tc.status)
      yield resultEvent
    }
    for (const cb of listeners["text"] ?? []) cb(text)
    yield { type: "text", text }
    for (const cb of listeners["done"] ?? []) cb(result)
    yield { type: "done", result }
  }

  const handle: StreamHandle = {
    [Symbol.asyncIterator]() {
      return gen()
    },
    async text() {
      return text
    },
    async result() {
      return result
    },
    on(event: string, callback: Function): StreamHandle {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(callback)
      return handle
    },
    async done() {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of handle) {
        /* consume */
      }
    },
  }
  return handle
}

/**
 * Create a mock agent for testing. The returned `Agent` implements the
 * full interface without any real initialization — no LLM calls, no
 * database, no file system access.
 */
export function createMockAgent(options: MockAgentOptions): Agent {
  if (options.replies.length === 0) {
    throw new Error("createMockAgent requires at least one reply in options.replies")
  }
  let callIndex = 0
  const toolCallStubs: ToolCallInfo[] = (options.toolCalls ?? []).map((tc) => ({
    tool: tc.tool,
    input: tc.input,
    output: tc.output,
    status: "completed" as const,
  }))

  function nextReply(): string {
    const reply = options.replies[callIndex % options.replies.length]
    callIndex++
    return reply
  }

  return {
    async run(_message: string, _options?: RunOptions): Promise<RunResult> {
      return makeMockResult(nextReply(), toolCallStubs)
    },
    stream(_message: string, _options?: RunOptions): StreamHandle {
      return makeMockStreamHandle(nextReply(), toolCallStubs)
    },
    async session(): Promise<SessionHandle> {
      const sessionCallIndex = { value: 0 }
      const handle: SessionHandle = {
        id: `mock-session-${Date.now()}`,
        async run(message: string, runOptions?: RunOptions): Promise<RunResult> {
          const idx = sessionCallIndex.value % options.replies.length
          sessionCallIndex.value++
          return makeMockResult(options.replies[idx], toolCallStubs)
        },
        stream(message: string, runOptions?: RunOptions): StreamHandle {
          const idx = sessionCallIndex.value % options.replies.length
          sessionCallIndex.value++
          return makeMockStreamHandle(options.replies[idx], toolCallStubs)
        },
        async messages() {
          return []
        },
        async fork(): Promise<SessionHandle> {
          return handle
        },
        async abort() {},
      }
      return handle
    },
    async tool(name: string): Promise<unknown> {
      const stub = options.toolCalls?.find((tc) => tc.tool === name)
      if (!stub) throw new Error(`Mock agent has no stub for tool "${name}"`)
      return stub.output
    },
    async models() {
      return ["mock/mock-model"]
    },
    async tools() {
      return (options.toolCalls ?? []).map((tc) => tc.tool)
    },
    async dispose() {},
  }
}

/**
 * Assert that a `RunResult` contains a successful call to a specific tool.
 */
export function assertToolSuccess(result: RunResult, toolName: string): ToolCallInfo {
  const calls = result.toolCalls ?? []
  if (calls.length === 0) throw new Error(`Expected a successful call to "${toolName}" but no tool calls were made`)
  const forTool = calls.filter((tc) => tc.tool === toolName)
  const match = forTool.find((tc) => tc.status === "completed")
  if (!match) {
    if (forTool.length > 0) throw new Error(`Tool "${toolName}" was called but failed (status: ${forTool[0].status})`)
    throw new Error(
      `Expected a successful call to "${toolName}" but it was never called. Called: ${calls.map((tc) => tc.tool).join(", ")}`,
    )
  }
  return match
}

/**
 * Assert that a `RunResult` contains a failed call to a specific tool.
 */
export function assertToolFailure(result: RunResult, toolName: string): ToolCallInfo {
  const calls = result.toolCalls ?? []
  if (calls.length === 0) throw new Error(`Expected a failed call to "${toolName}" but no tool calls were made`)
  const forTool = calls.filter((tc) => tc.tool === toolName)
  const match = forTool.find((tc) => tc.status === "error")
  if (!match) {
    if (forTool.length > 0) throw new Error(`Tool "${toolName}" was called but succeeded (expected failure)`)
    throw new Error(
      `Expected a failed call to "${toolName}" but it was never called. Called: ${calls.map((tc) => tc.tool).join(", ")}`,
    )
  }
  return match
}
