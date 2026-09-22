import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import { expect, test, vi } from "vitest"
import { RunCommand } from "../../src/cli/cmd/run"

test.each([false, "check"])(
  "headless run rejects HTTP submission failures and closes an idle event stream: %s",
  async (command) => {
    let eventClosed = false
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/event")) {
        response.writeHead(200, { "content-type": "text/event-stream" })
        response.write('data: {"type":"server.connected","properties":{}}\n\n')
        response.on("close", () => {
          eventClosed = true
        })
        return
      }
      response.setHeader("content-type", "application/json")
      if (request.url === "/session" && request.method === "POST") {
        response.end(JSON.stringify({ id: "ses_request_error" }))
        return
      }
      response.statusCode = 500
      response.end(JSON.stringify({ name: "UnknownError", data: { message: "Request preparation failed" } }))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing test server address")
    try {
      await expect(
        RunCommand.handler({
          message: ["Apply a focused correction"],
          command,
          "--": [],
          attach: `http://127.0.0.1:${address.port}`,
          format: "json",
        } as never),
      ).rejects.toMatchObject({ name: "UnknownError", data: { message: "Request preparation failed" } })
      await expect.poll(() => eventClosed).toBe(true)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

/**
 * Stub-server harness for the `--format json` event stream: one SSE channel,
 * one scripted submission, stored messages for the final read. Returns every
 * stdout line the CLI wrote plus the resulting process exit code.
 */
async function runEventStream(input: {
  model?: string
  events?: Array<Record<string, unknown>>
  promptResponse?: { info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }
  messages?: unknown[]
  providers?: { all: Array<{ id: string; models: Record<string, unknown> }>; connected: string[] }
  timeout?: number
  holdMessage?: boolean
  afterSubmit?: () => void
}) {
  const sessionID = "ses_stream"
  let output = ""
  const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as any)
  let eventsResponse: ServerResponse | undefined
  let heldMessageResponse: ServerResponse | undefined
  let abortCalled = false
  const emit = (event: Record<string, unknown>) => eventsResponse!.write(`data: ${JSON.stringify(event)}\n\n`)
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/event")) {
      eventsResponse = response
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"server.connected","properties":{}}\n\n')
      return
    }
    response.setHeader("content-type", "application/json")
    if (request.url === "/provider") {
      response.end(JSON.stringify(input.providers ?? { all: [], connected: [] }))
      return
    }
    if (request.url === "/session" && request.method === "POST") {
      response.end(JSON.stringify({ id: sessionID }))
      return
    }
    if (request.method === "POST" && request.url?.endsWith("/abort")) {
      abortCalled = true
      // The abort is what completes a held submission: flush the scripted
      // frames and settle the /message response only now, then answer true.
      if (heldMessageResponse) {
        for (const event of input.events ?? []) emit(event)
        heldMessageResponse.end(JSON.stringify(input.promptResponse ?? {}))
        heldMessageResponse = undefined
      }
      response.end("true")
      return
    }
    if (request.method === "POST" && request.url?.endsWith("/message")) {
      if (input.holdMessage) {
        // Simulate a long generation: hold the submission open until the abort
        // route fires, mirroring a server whose generation only stops on abort.
        heldMessageResponse = response
        input.afterSubmit?.()
        return
      }
      // Scripted SSE frames are flushed before the submission settles so the
      // drain check can observe the completed message and its parts.
      for (const event of input.events ?? []) emit(event)
      response.end(JSON.stringify(input.promptResponse ?? {}))
      return
    }
    if (request.method === "GET" && request.url?.endsWith("/message")) {
      response.end(JSON.stringify(input.messages ?? []))
      return
    }
    if (request.method === "POST" && request.url?.includes("/reply")) {
      response.end("true")
      return
    }
    response.end("[]")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const previousExitCode = process.exitCode
  try {
    const settled = await Promise.resolve(
      RunCommand.handler({
        message: ["Do the thing"],
        command: false,
        "--": [],
        attach: `http://127.0.0.1:${address.port}`,
        format: "json",
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
      } as never),
    ).then(
      () => ({ rejected: undefined as unknown }),
      (error: unknown) => ({ rejected: error }),
    )
    return {
      output,
      lines: output.split("\n").filter((line) => line.trim().length > 0),
      exitCode: process.exitCode,
      rejected: settled.rejected,
      abortCalled,
    }
  } finally {
    write.mockRestore()
    process.exitCode = previousExitCode
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const assistantInfo = (sessionID: string) => ({
  id: "msg_final",
  sessionID,
  role: "assistant",
  time: { created: 1, completed: 2 },
})

const abortedError = { name: "MessageAbortedError", data: { message: "This operation was aborted" } }

test("run event stream ends with exactly one result line carrying usage", async () => {
  const sessionID = "ses_stream"
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "All done",
    time: { start: 1, end: 2 },
  }
  const { lines, exitCode, rejected } = await runEventStream({
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [textPart] },
    messages: [
      {
        info: {
          id: "msg_final",
          role: "assistant",
          tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 4, write: 5 } },
        },
        parts: [{ type: "text", text: "All done" }],
      },
    ],
  })

  expect(rejected).toBeUndefined()
  expect(exitCode).toBeUndefined()
  const resultLines = lines.filter((line) => line.includes('"type":"result"'))
  expect(resultLines).toHaveLength(1)
  expect(lines[lines.length - 1]).toBe(resultLines[0])

  const result = JSON.parse(resultLines[0])
  expect(result.type).toBe("result")
  expect(result.sessionID).toBe(sessionID)
  expect(result.status).toBe("completed")
  expect(result.text).toBe("All done")
  expect(result.permissionDenials).toBe(0)
  expect(result.usage).toEqual({ input: 10, output: 20, reasoning: 3, cacheRead: 4, cacheWrite: 5 })
})

test("run result omits usage when stored messages carry no token counts", async () => {
  const sessionID = "ses_stream"
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "No counts here",
    time: { start: 1, end: 2 },
  }
  const { lines } = await runEventStream({
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [textPart] },
    messages: [],
  })

  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("completed")
  expect(result.text).toBe("No counts here")
  expect(JSON.stringify(result)).not.toContain('"usage"')
})

test("run --format json reports unknown provider as a structured error line and exits 1", async () => {
  // The connected provider must not serve the requested model under any ID:
  // resolveRunModel intentionally follows a SKU to a connected provider (a
  // disabled native provider re-served by a gateway), so an `m1` entry on
  // `real-provider` would re-route `nod-provider/m1` to it instead of
  // erroring, and the run would proceed past validation. The stub must keep
  // the requested model absent everywhere for this to be a provider error.
  const { lines, exitCode, rejected } = await runEventStream({
    model: "nod-provider/m1",
    providers: { all: [{ id: "real-provider", models: { m2: {} } }], connected: ["real-provider"] },
  })

  expect(rejected).toBeDefined()
  expect(exitCode).toBe(1)
  expect(lines).toHaveLength(1)
  const event = JSON.parse(lines[0])
  expect(event.type).toBe("error")
  expect(event.error.code).toBe("provider")
  expect(event.error.message).toContain('Unknown provider "nod-provider"')
  // The early line carries exactly type + error, and no result follows it.
  expect(Object.keys(event)).toEqual(["type", "error"])
  expect(lines.some((line) => line.includes('"type":"result"'))).toBe(false)
})

test("run whose only tool call was denied emits permission_denied and exits blocked", async () => {
  const sessionID = "ses_stream"
  const deniedBashPart = {
    id: "prt_bash",
    messageID: "msg_final",
    sessionID,
    type: "tool",
    callID: "call_bash",
    tool: "bash",
    state: {
      status: "error",
      input: { command: "rm -rf /tmp/fixture" },
      error: "Permission denied",
      time: { start: 1, end: 2 },
    },
  }
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Could not proceed",
    time: { start: 1, end: 3 },
  }
  const { lines, exitCode } = await runEventStream({
    events: [
      {
        type: "permission.asked",
        properties: { id: "per_stream", sessionID, permission: "bash", patterns: ["rm -rf /tmp/fixture"] },
      },
      { type: "message.part.updated", properties: { part: deniedBashPart } },
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [deniedBashPart, textPart] },
    messages: [
      {
        info: {
          id: "msg_final",
          role: "assistant",
          tokens: { input: 8, output: 4, reasoning: 0, cache: { read: 1, write: 1 } },
        },
        parts: [{ type: "text", text: "Could not proceed" }],
      },
    ],
  })

  const denial = JSON.parse(lines.find((line) => line.includes('"type":"permission_denied"'))!)
  expect(denial).toMatchObject({
    type: "permission_denied",
    sessionID,
    permission: "bash",
    patterns: ["rm -rf /tmp/fixture"],
  })
  expect(typeof denial.timestamp).toBe("number")

  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("blocked")
  expect(result.permissionDenials).toBe(1)
  expect(result.text).toBe("Could not proceed")
  expect(exitCode).toBe(3)
})

test("run whose only tool call was denied by the read-only sandbox exits blocked without a permission ask", async () => {
  const sessionID = "ses_stream"
  // Under --sandbox read-only a denied bash call fails as a tool error whose
  // text starts with the prompt-tools denial prefix — no permission.asked
  // event ever fires, but the run is blocked the same way.
  const deniedBashPart = {
    id: "prt_bash_ro",
    messageID: "msg_final",
    sessionID,
    type: "tool",
    callID: "call_bash_ro",
    tool: "bash",
    state: {
      status: "error",
      input: { command: "cargo build" },
      error: "Tool denied in read-only mode: bash is not permitted to write",
      time: { start: 1, end: 2 },
    },
  }
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Cannot build in read-only mode",
    time: { start: 1, end: 3 },
  }
  const { lines, exitCode } = await runEventStream({
    events: [
      { type: "message.part.updated", properties: { part: deniedBashPart } },
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [deniedBashPart, textPart] },
    messages: [
      {
        info: { id: "msg_final", role: "assistant" },
        parts: [{ type: "text", text: "Cannot build in read-only mode" }],
      },
    ],
  })

  // The denial was a tool error, not a permission ask: no permission_denied
  // event, but the tool_use part carries the denial text.
  expect(lines.some((line) => line.includes('"type":"permission_denied"'))).toBe(false)
  const toolUse = JSON.parse(lines.find((line) => line.includes('"type":"tool_use"'))!)
  expect(toolUse.part.tool).toBe("bash")
  expect(toolUse.part.state.error).toContain("Tool denied in read-only mode")

  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("blocked")
  expect(result.permissionDenials).toBe(1)
  expect(result.text).toBe("Cannot build in read-only mode")
  expect(exitCode).toBe(3)
})

test("run that recovered after a denial stays completed with exit 0", async () => {
  const sessionID = "ses_stream"
  const writePart = {
    id: "prt_write",
    messageID: "msg_final",
    sessionID,
    type: "tool",
    callID: "call_write",
    tool: "write",
    state: {
      status: "completed",
      input: { filePath: "notes.txt", content: "ok" },
      output: "wrote notes.txt",
      title: "Write notes.txt",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Wrote it after all",
    time: { start: 1, end: 3 },
  }
  const { lines, exitCode } = await runEventStream({
    events: [
      {
        type: "permission.asked",
        properties: { id: "per_stream", sessionID, permission: "bash", patterns: ["cargo build"] },
      },
      { type: "message.part.updated", properties: { part: writePart } },
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [writePart, textPart] },
    messages: [
      {
        info: {
          id: "msg_final",
          role: "assistant",
          tokens: { input: 12, output: 6, reasoning: 1, cache: { read: 2, write: 2 } },
        },
        parts: [{ type: "text", text: "Wrote it after all" }],
      },
    ],
  })

  expect(lines.some((line) => line.includes('"type":"permission_denied"'))).toBe(true)
  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("completed")
  expect(result.permissionDenials).toBe(1)
  expect(exitCode).toBeUndefined()
})

test("run --timeout aborts the held submission and exits 124 with a single timeout result", async () => {
  const sessionID = "ses_stream"
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Partial answer",
    time: { start: 1, end: 2 },
  }
  const { lines, exitCode, rejected, abortCalled } = await runEventStream({
    timeout: 0.05,
    holdMessage: true,
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: { ...assistantInfo(sessionID), error: abortedError } } },
    ],
    promptResponse: { info: { ...assistantInfo(sessionID), error: abortedError }, parts: [textPart] },
    messages: [
      {
        info: { id: "msg_final", role: "assistant" },
        parts: [{ type: "text", text: "Partial answer" }],
      },
    ],
  })

  expect(rejected).toBeUndefined()
  expect(abortCalled).toBe(true)
  expect(exitCode).toBe(124)
  const resultLines = lines.filter((line) => line.includes('"type":"result"'))
  expect(resultLines).toHaveLength(1)
  expect(lines[lines.length - 1]).toBe(resultLines[0])
  const result = JSON.parse(resultLines[0])
  expect(result.status).toBe("timeout")
  // The self-requested abort is the expected outcome, not a failure: no
  // `error` stream event is emitted.
  expect(lines.some((line) => line.includes('"type":"error"'))).toBe(false)
})

test("run SIGINT cancels the held submission and exits 130 with a single cancelled result", async () => {
  const sessionID = "ses_stream"
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Partial answer",
    time: { start: 1, end: 2 },
  }
  const { lines, exitCode, rejected, abortCalled } = await runEventStream({
    holdMessage: true,
    afterSubmit: () => process.emit("SIGINT"),
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: { ...assistantInfo(sessionID), error: abortedError } } },
    ],
    promptResponse: { info: { ...assistantInfo(sessionID), error: abortedError }, parts: [textPart] },
    messages: [
      {
        info: { id: "msg_final", role: "assistant" },
        parts: [{ type: "text", text: "Partial answer" }],
      },
    ],
  })

  expect(rejected).toBeUndefined()
  expect(abortCalled).toBe(true)
  expect(exitCode).toBe(130)
  const resultLines = lines.filter((line) => line.includes('"type":"result"'))
  expect(resultLines).toHaveLength(1)
  expect(lines[lines.length - 1]).toBe(resultLines[0])
  const result = JSON.parse(resultLines[0])
  expect(result.status).toBe("cancelled")
  // The self-requested abort is the expected outcome, not a failure: no
  // `error` stream event is emitted.
  expect(lines.some((line) => line.includes('"type":"error"'))).toBe(false)
})

test("run reports a server-side abort error with no timeout or SIGINT as a failure", async () => {
  const sessionID = "ses_stream"
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Partial answer",
    time: { start: 1, end: 2 },
  }
  const { lines, exitCode, rejected } = await runEventStream({
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: { ...assistantInfo(sessionID), error: abortedError } } },
    ],
    promptResponse: { info: { ...assistantInfo(sessionID), error: abortedError }, parts: [textPart] },
    messages: [
      {
        info: { id: "msg_final", role: "assistant" },
        parts: [{ type: "text", text: "Partial answer" }],
      },
    ],
  })

  expect(rejected).toBeUndefined()
  expect(exitCode).toBe(1)
  const resultLines = lines.filter((line) => line.includes('"type":"result"'))
  expect(resultLines).toHaveLength(1)
  const result = JSON.parse(resultLines[0])
  expect(result.status).toBe("error")
  // This abort was not requested by this process, so it is reported as an
  // error today: the stream emits an `error` event.
  expect(lines.some((line) => line.includes('"type":"error"'))).toBe(true)
})
