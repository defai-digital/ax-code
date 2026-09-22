import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { expect, test, vi } from "vitest"
import { RunCommand } from "../../src/cli/cmd/run"
import { tmpdir } from "../fixture/fixture"

test.each([false, "check"])(
  "headless run converts HTTP submission failures into a structured error line: %s",
  async (command) => {
    let eventClosed = false
    let output = ""
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      output += String(chunk)
      return true
    }) as any)
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
    const previousExitCode = process.exitCode
    try {
      await expect(
        RunCommand.handler({
          message: ["Apply a focused correction"],
          command,
          "--": [],
          attach: `http://127.0.0.1:${address.port}`,
          format: "json",
        } as never),
      ).rejects.toMatchObject({ name: "UICancelledError" })
      await expect.poll(() => eventClosed).toBe(true)
      // The rejection is converted: exactly one structured error line on
      // stdout, no result line, no raw body leak.
      const lines = output.split("\n").filter((line) => line.trim().length > 0)
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0])).toEqual({
        type: "error",
        error: { code: "internal", message: "Request preparation failed" },
      })
      expect(process.exitCode).toBe(1)
    } finally {
      write.mockRestore()
      process.exitCode = previousExitCode
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
  session?: string
  continue?: boolean
  /** Output format for the handler args; the NDJSON event stream by default. */
  format?: string
  /** Status for GET /session/{id} (the --session preflight); 200 by default. */
  sessionGet?: number
  /** Error status for POST /message, making the submission reject. */
  messageStatus?: number
  /** Body for the rejected POST /message; defaults to SessionNotFoundError. */
  messageError?: { name: string; data: { message: string } }
  events?: Array<Record<string, unknown>>
  promptResponse?: { info?: Record<string, unknown>; parts?: Array<Record<string, unknown>> }
  messages?: unknown[]
  providers?: { all: Array<{ id: string; models: Record<string, unknown> }>; connected: string[] }
  timeout?: number
  holdMessage?: boolean
  afterSubmit?: () => void
  /** Capture the raw POST /message request body (see the captureBody tests). */
  captureBody?: boolean
  /** Capture the POST /message request headers (see the runtime-token test). */
  captureHeaders?: boolean
  /** Error status for POST /session (the first SDK call); 201/200 by default. */
  sessionCreateStatus?: number
  /** Body for a rejected POST /session; defaults to the runtime auth ForbiddenError. */
  sessionCreateError?: { name: string; data: { message: string } }
  /**
   * Invoked by the stub on the first request it receives that belongs to the
   * run's bootstrap (the `/provider` model-validation request or the
   * `POST /session` create) — before the stub answers it, so the hook can
   * emit a signal while the request is still in flight and no session
   * exists yet.
   */
  beforeSession?: () => void
  /** Extra fields merged into the handler args (e.g. sandbox, steering flags). */
  extraArgs?: Record<string, unknown>
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
  let capturedMessageBody: string | undefined
  let capturedMessageHeaders: NodeJS.Dict<string | string[]> | undefined
  const permissionReplies: string[] = []
  let beforeSessionFired = false
  const fireBeforeSession = () => {
    if (beforeSessionFired || !input.beforeSession) return
    beforeSessionFired = true
    input.beforeSession()
  }
  const emit = (event: Record<string, unknown>) => eventsResponse!.write(`data: ${JSON.stringify(event)}\n\n`)
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith("/event")) {
      eventsResponse = response
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"server.connected","properties":{}}\n\n')
      return
    }
    response.setHeader("content-type", "application/json")
    const pathname = (request.url ?? "").split("?")[0]
    if (request.url === "/provider") {
      fireBeforeSession()
      response.end(JSON.stringify(input.providers ?? { all: [], connected: [] }))
      return
    }
    if (request.url === "/session" && request.method === "POST") {
      fireBeforeSession()
      if (input.sessionCreateStatus !== undefined) {
        response.statusCode = input.sessionCreateStatus
        response.end(
          JSON.stringify(
            input.sessionCreateError ?? {
              name: "ForbiddenError",
              data: { message: "Runtime authorization required" },
            },
          ),
        )
        return
      }
      response.end(JSON.stringify({ id: sessionID }))
      return
    }
    // The --session preflight: GET /session/{id} with a configurable status.
    if (request.method === "GET" && /^\/session\/[^/]+$/.test(pathname)) {
      const requestedID = pathname.split("/")[2]
      const status = input.sessionGet ?? 200
      response.statusCode = status
      if (status !== 200) {
        response.end(
          JSON.stringify({ name: "SessionNotFoundError", data: { message: `Session not found: ${requestedID}` } }),
        )
        return
      }
      response.end(JSON.stringify({ id: requestedID }))
      return
    }
    if (request.method === "POST" && pathname.endsWith("/abort")) {
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
    if (request.method === "POST" && pathname.endsWith("/message")) {
      // Drain the request body first so captureBody can read every chunk.
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      if (input.captureBody) capturedMessageBody = Buffer.concat(chunks).toString("utf8")
      if (input.captureHeaders) capturedMessageHeaders = request.headers
      if (input.messageStatus !== undefined) {
        response.statusCode = input.messageStatus
        response.end(
          JSON.stringify(
            input.messageError ?? {
              name: "SessionNotFoundError",
              data: { message: `Session not found: ${sessionID}` },
            },
          ),
        )
        return
      }
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
    if (request.method === "GET" && pathname.endsWith("/message")) {
      response.end(JSON.stringify(input.messages ?? []))
      return
    }
    if (request.method === "POST" && pathname.includes("/reply")) {
      permissionReplies.push(pathname)
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
        format: input.format ?? "json",
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.session === undefined ? {} : { session: input.session }),
        ...(input.continue === undefined ? {} : { continue: input.continue }),
        ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
        ...(input.extraArgs ?? {}),
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
      messageBody: capturedMessageBody,
      messageHeaders: capturedMessageHeaders,
      permissionReplies,
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

test("child-session permission asks are auto-rejected, named, and counted (G1)", async () => {
  const sessionID = "ses_stream"
  const childID = "ses_child_task"
  // The run recovered with a completed write on the MAIN session, so the
  // denial counting is observable independently of the blocked-run outcome.
  const writePart = {
    id: "prt_write_child_run",
    messageID: "msg_final",
    sessionID,
    type: "tool",
    callID: "call_write_child_run",
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
    id: "prt_text_child_run",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: "Done via subagent",
    time: { start: 1, end: 3 },
  }
  const { lines, exitCode, rejected, permissionReplies } = await runEventStream({
    events: [
      // The task tool spawned a child session under the main session.
      { type: "session.created", properties: { info: { id: childID, parentID: sessionID } } },
      // The child asked for permission; the ask carries the CHILD session id.
      {
        type: "permission.asked",
        properties: { id: "per_child", sessionID: childID, permission: "bash", patterns: ["rm -rf /tmp/x"] },
      },
      { type: "message.part.updated", properties: { part: writePart } },
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [writePart, textPart] },
    messages: [
      {
        info: { id: "msg_final", role: "assistant" },
        parts: [{ type: "text", text: "Done via subagent" }],
      },
    ],
  })

  expect(rejected).toBeUndefined()
  // The denial event names the asking child session, not the main session.
  const denial = JSON.parse(lines.find((line) => line.includes('"type":"permission_denied"'))!)
  expect(denial).toMatchObject({
    type: "permission_denied",
    sessionID: childID,
    permission: "bash",
    patterns: ["rm -rf /tmp/x"],
  })
  // The stub saw exactly one POST /permission/<requestID>/reply for the
  // child's ask — without the session tree nobody replied and the child
  // blocked until --timeout.
  expect(permissionReplies).toHaveLength(1)
  expect(permissionReplies[0]).toContain("per_child")
  // The child denial feeds the run's blocked-run accounting.
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

test("run SIGINT before the session exists emits one cancelled result and never submits", async () => {
  // The signal lands while POST /session is still in flight (the stub emits
  // it before answering), so no session exists yet: the pre-session branch
  // must behave like the pre-session --timeout and commit the terminal
  // outcome itself instead of exiting stdout-silent.
  const { lines, exitCode, rejected, abortCalled, messageBody } = await runEventStream({
    beforeSession: () => process.emit("SIGINT"),
    captureBody: true,
  })

  // The aborted bootstrap calls are teardown fallout of the committed cancel
  // outcome: the handler-level conversion swallows them.
  expect(rejected).toBeUndefined()
  expect(exitCode).toBe(130)
  // Exactly one stdout line: the early terminal result, with the cancel
  // status and no session id.
  expect(lines).toHaveLength(1)
  const result = JSON.parse(lines[0])
  expect(result.type).toBe("result")
  expect(result.status).toBe("cancelled")
  expect(result.sessionID).toBe("")
  expect(result.text).toBe("")
  expect(result.permissionDenials).toBe(0)
  // The run never reached the prompt submission, and there was no session to
  // abort server-side.
  expect(messageBody).toBeUndefined()
  expect(abortCalled).toBe(false)
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

test("run --session preflight reports a missing session as one structured session error", async () => {
  const { lines, exitCode, rejected } = await runEventStream({
    session: "ses_missing",
    sessionGet: 404,
  })

  // The preflight fails before anything is created: one structured error
  // line, exit 1, no result line, and a cancelled (not raw) rejection.
  expect(rejected).toMatchObject({ name: "UICancelledError" })
  expect(exitCode).toBe(1)
  expect(lines).toHaveLength(1)
  const event = JSON.parse(lines[0])
  expect(event.type).toBe("error")
  expect(event.error.code).toBe("session")
  expect(event.error.message).toContain("Session not found: ses_missing")
  expect(event.error.message).toContain("ax-code session list --json")
  expect(lines.some((line) => line.includes('"type":"result"'))).toBe(false)
})

test("prompt rejection with a SessionNotFoundError body converts instead of leaking [object Object]", async () => {
  const { output, lines, exitCode, rejected } = await runEventStream({
    // No --session, so the preflight does not apply: the POST /message
    // submission itself rejects with a 404 SessionNotFoundError body.
    messageStatus: 404,
  })

  expect(rejected).toMatchObject({ name: "UICancelledError" })
  expect(exitCode).toBe(1)
  expect(lines).toHaveLength(1)
  const event = JSON.parse(lines[0])
  expect(event.type).toBe("error")
  expect(event.error.code).toBe("session")
  expect(event.error.message).toContain("Session not found")
  expect(lines.some((line) => line.includes('"type":"result"'))).toBe(false)
  // The deserialized body must never reach stdout as a raw stringification.
  expect(output).not.toContain("[object Object]")
})

test("--continue with --session is a mutual-exclusion usage error before any request", async () => {
  const { lines, exitCode, rejected } = await runEventStream({
    continue: true,
    session: "ses_stream",
  })

  expect(rejected).toMatchObject({ name: "UICancelledError" })
  expect(exitCode).toBe(1)
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0])).toEqual({
    type: "error",
    error: { code: "usage", message: "--continue and --session are mutually exclusive" },
  })
})

/** Minimal successful exchange for tests that only inspect the request body. */
function scriptedOkExchange(sessionID: string) {
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: '{"summary":"ok"}',
    time: { start: 1, end: 2 },
  }
  return {
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [textPart] },
    messages: [{ info: { id: "msg_final", role: "assistant" }, parts: [{ type: "text", text: '{"summary":"ok"}' }] }],
  }
}

test("--sandbox read-only sends isolation.mode in the POST /message body", async () => {
  // --sandbox is a global yargs option declared in boot.ts (not on the run
  // builder); yargs merges global options into the command's parsed args, so
  // RunCommand.handler receives it as args.sandbox and reads it from there.
  // The test passes it directly through the handler args — the same field the
  // real CLI populates.
  const { messageBody, rejected } = await runEventStream({
    ...scriptedOkExchange("ses_stream"),
    captureBody: true,
    extraArgs: { sandbox: "read-only" },
  })

  expect(rejected).toBeUndefined()
  const body = JSON.parse(messageBody ?? "{}")
  // Mirrors bootstrap/env.ts: network is only true for full-access.
  expect(body.isolation).toEqual({ mode: "read-only", network: false })
})

test("steering flags reach the POST /message body as system, tools, and format", async () => {
  await using tmp = await tmpdir()
  const schema = {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
  }
  await writeFile(path.join(tmp.path, "schema.json"), JSON.stringify(schema))

  const { messageBody, rejected } = await runEventStream({
    ...scriptedOkExchange("ses_stream"),
    captureBody: true,
    extraArgs: {
      "append-system-prompt": "Answer in English only",
      "disallowed-tools": ["bash,write", "read"],
      "output-schema": path.join(tmp.path, "schema.json"),
    },
  })

  expect(rejected).toBeUndefined()
  const body = JSON.parse(messageBody ?? "{}")
  expect(body.system).toBe("Answer in English only")
  // F4: the per-turn tools map always disables the interactive
  // question/plan_exit tools (resumed sessions never see the create-time
  // rules) and merges in --disallowed-tools.
  expect(body.tools).toEqual({ question: false, plan_exit: false, bash: false, write: false, read: false })
  // --output-schema both steers the model and is enforced afterwards: the
  // parsed schema object is sent as the json_schema format with up to two
  // server-side retries before the CLI's own final validation runs.
  expect(body.format).toEqual({ type: "json_schema", schema, retryCount: 2 })
})

/**
 * Fixture for a `--output-schema` run: the server steered the model through
 * the StructuredOutput tool, stored the captured object on `info.structured`,
 * and the assistant message carries no text part at all.
 */
function structuredOutputExchange(sessionID: string) {
  const structured = { summary: "ok", checks: 3 }
  const structuredToolPart = {
    id: "prt_structured",
    messageID: "msg_final",
    sessionID,
    type: "tool",
    callID: "call_structured",
    tool: "StructuredOutput",
    state: {
      status: "completed",
      input: structured,
      output: "Structured output captured successfully.",
      title: "Structured Output",
      metadata: { valid: true },
      time: { start: 1, end: 2 },
    },
  }
  return {
    structured,
    exchange: {
      events: [
        { type: "message.part.updated", properties: { part: structuredToolPart } },
        { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
      ],
      promptResponse: { info: assistantInfo(sessionID), parts: [structuredToolPart] },
      // Stored messages carry `structured` and no text part — the final text
      // must come from the captured object, not a text part.
      messages: [{ info: { id: "msg_final", role: "assistant", structured }, parts: [] }],
    },
  }
}

async function writeStructuredSchema(tmp: { path: string }) {
  const schema = {
    type: "object",
    properties: { summary: { type: "string" }, checks: { type: "integer" } },
    required: ["summary", "checks"],
    additionalProperties: false,
  }
  const file = path.join(tmp.path, "schema.json")
  await writeFile(file, JSON.stringify(schema))
  return file
}

test("run --output-schema reports the captured structured object as the final text", async () => {
  await using tmp = await tmpdir()
  const schemaFile = await writeStructuredSchema(tmp)
  const { structured, exchange } = structuredOutputExchange("ses_stream")

  const { lines, exitCode, rejected } = await runEventStream({
    ...exchange,
    extraArgs: {
      "output-schema": schemaFile,
      "output-file": path.join(tmp.path, "result.json"),
    },
  })

  expect(rejected).toBeUndefined()
  expect(exitCode).toBeUndefined()
  // The terminal result line is stdout's final text and carries the serialized
  // structured object; the post-run schema validation of that same string
  // passed (a failure would exit 1 with an error instead).
  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("completed")
  expect(result.text).toBe(JSON.stringify(structured))
  expect(lines.some((line) => line.includes('"type":"error"'))).toBe(false)
  // --output-file receives the same serialized object.
  await expect(readFile(path.join(tmp.path, "result.json"), "utf8")).resolves.toBe(JSON.stringify(structured))
})

test("run --output-schema prints the serialized structured object on stdout in the default format", async () => {
  await using tmp = await tmpdir()
  const schemaFile = await writeStructuredSchema(tmp)
  const { structured, exchange } = structuredOutputExchange("ses_stream")

  const { lines, exitCode, rejected } = await runEventStream({
    ...exchange,
    format: "default",
    extraArgs: { "output-schema": schemaFile },
  })

  expect(rejected).toBeUndefined()
  expect(exitCode).toBeUndefined()
  // No text part was streamed, so the serialized structured object itself is
  // the final stdout text (headers and tool blocks go to stderr).
  expect(lines).toHaveLength(1)
  expect(lines[lines.length - 1]).toBe(JSON.stringify(structured))
})

test("run --output-schema with a StructuredOutputError assistant message stays a run error", async () => {
  await using tmp = await tmpdir()
  const schemaFile = await writeStructuredSchema(tmp)
  const sessionID = "ses_stream"
  const structuredError = {
    name: "StructuredOutputError",
    data: { message: "Model did not produce structured output" },
  }

  const { lines, exitCode, rejected } = await runEventStream({
    events: [
      { type: "message.updated", properties: { info: { ...assistantInfo(sessionID), error: structuredError } } },
    ],
    promptResponse: { info: { ...assistantInfo(sessionID), error: structuredError }, parts: [] },
    // The model never called the tool: no `structured`, no text part.
    messages: [{ info: { id: "msg_final", role: "assistant" }, parts: [] }],
    extraArgs: { "output-schema": schemaFile },
  })

  expect(rejected).toBeUndefined()
  expect(exitCode).toBe(1)
  // The server-side StructuredOutputError surfaces as a normal run error:
  // status "error" on the terminal result and exit 1.
  const errorLine = lines.find((line) => line.includes('"type":"error"'))
  expect(errorLine).toBeDefined()
  expect(JSON.parse(errorLine!)).toMatchObject({
    type: "error",
    error: { name: "StructuredOutputError" },
  })
  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("error")
})

test("run --attach sends AX_CODE_RUNTIME_TOKEN as x-ax-code-runtime-token on POST /message", async () => {
  vi.stubEnv("AX_CODE_RUNTIME_TOKEN", "tok-123")
  try {
    const { rejected, messageHeaders } = await runEventStream({
      ...scriptedOkExchange("ses_stream"),
      captureHeaders: true,
    })

    expect(rejected).toBeUndefined()
    expect(messageHeaders?.["x-ax-code-runtime-token"]).toBe("tok-123")
  } finally {
    vi.unstubAllEnvs()
  }
})

test("run --attach with a 403 Runtime authorization required body classifies as attach", async () => {
  const { lines, exitCode, rejected } = await runEventStream({
    sessionCreateStatus: 403,
    sessionCreateError: { name: "ForbiddenError", data: { message: "Runtime authorization required" } },
  })

  expect(rejected).toMatchObject({ name: "UICancelledError" })
  expect(exitCode).toBe(1)
  expect(lines).toHaveLength(1)
  const event = JSON.parse(lines[0])
  expect(event.type).toBe("error")
  expect(event.error.code).toBe("attach")
  expect(event.error.message).toContain("Runtime authorization required")
  expect(event.error.message).toContain("127.0.0.1")
  expect(event.error.message).toContain("--runtime")
  expect(event.error.message).toContain("AX_CODE_RUNTIME_TOKEN")
  expect(lines.some((line) => line.includes('"type":"result"'))).toBe(false)
})

test("run --output-schema reports a schema-violating final text as an error result (F1)", async () => {
  await using tmp = await tmpdir()
  // The assistant produced plain text that violates the schema the server was
  // told to steer toward; the CLI's post-run validation must fail the run:
  // one structured error event, terminal result status "error", exit 1.
  const schema = {
    type: "object",
    required: ["status"],
    properties: { status: { const: "ok" } },
    additionalProperties: false,
  }
  const schemaFile = path.join(tmp.path, "schema.json")
  await writeFile(schemaFile, JSON.stringify(schema))
  const sessionID = "ses_stream"
  const badText = '{"status":"bad"}'
  const textPart = {
    id: "prt_text",
    messageID: "msg_final",
    sessionID,
    type: "text",
    text: badText,
    time: { start: 1, end: 2 },
  }

  const { lines, exitCode, rejected } = await runEventStream({
    events: [
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [textPart] },
    messages: [{ info: { id: "msg_final", role: "assistant" }, parts: [{ type: "text", text: badText }] }],
    extraArgs: { "output-schema": schemaFile },
  })

  expect(rejected).toBeUndefined()
  expect(exitCode).toBe(1)
  const errorLines = lines.filter((line) => line.includes('"type":"error"'))
  expect(errorLines).toHaveLength(1)
  const errorEvent = JSON.parse(errorLines[0])
  expect(errorEvent.type).toBe("error")
  expect(errorEvent.error.name).toBe("StructuredOutputError")
  expect(errorEvent.error.data.message).toContain("Output schema validation failed")
  // The terminal result reports the failure (not "completed") and stays the
  // last stdout line; exit 1 is not downgraded by any other precedence.
  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("error")
  expect(lines[lines.length - 1]).toBe(lines.find((line) => line.includes('"type":"result"')))
})

test("run --session sends question:false and plan_exit:false in the per-turn tools map (F4)", async () => {
  // Create-time deny rules never reach a resumed session; the per-turn tools
  // map is the only mechanism that disables the interactive tools there.
  const { messageBody, rejected } = await runEventStream({
    ...scriptedOkExchange("ses_stream"),
    session: "ses_stream",
    captureBody: true,
  })

  expect(rejected).toBeUndefined()
  const body = JSON.parse(messageBody ?? "{}")
  expect(body.tools).toMatchObject({ question: false, plan_exit: false })
})

test("run whose only tool call was denied by a permission deny rule exits blocked (F12)", async () => {
  // A deny rule (e.g. --disallowed-tools) never asks; the call fails with the
  // DeniedError text from permission/index.ts. Like the read-only sandbox
  // denial, it must count toward blocked-run accounting without a
  // permission_denied event.
  const sessionID = "ses_stream"
  const deniedBashPart = {
    id: "prt_bash_rule",
    messageID: "msg_final",
    sessionID,
    type: "tool",
    callID: "call_bash_rule",
    tool: "bash",
    state: {
      status: "error",
      input: { command: "rm -rf /tmp/fixture" },
      error:
        "The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules …",
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
      { type: "message.part.updated", properties: { part: deniedBashPart } },
      { type: "message.part.updated", properties: { part: textPart } },
      { type: "message.updated", properties: { info: assistantInfo(sessionID) } },
    ],
    promptResponse: { info: assistantInfo(sessionID), parts: [deniedBashPart, textPart] },
    messages: [
      {
        info: { id: "msg_final", role: "assistant" },
        parts: [{ type: "text", text: "Could not proceed" }],
      },
    ],
  })

  expect(lines.some((line) => line.includes('"type":"permission_denied"'))).toBe(false)
  const toolUse = JSON.parse(lines.find((line) => line.includes('"type":"tool_use"'))!)
  expect(toolUse.part.state.error).toContain("The user has specified a rule")

  const result = JSON.parse(lines[lines.length - 1])
  expect(result.type).toBe("result")
  expect(result.status).toBe("blocked")
  expect(result.permissionDenials).toBe(1)
  expect(exitCode).toBe(3)
})
