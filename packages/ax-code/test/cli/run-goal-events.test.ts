import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import { expect, test, vi } from "vitest"
import { RunCommand } from "../../src/cli/cmd/run"

// Exercise the real CLI handler, SDK and SSE transport without a model provider.
test.each(["goal", false])(
  "headless submission keeps handling permissions after an early idle: %s",
  async (command) => {
    const previousExitCode = process.exitCode
    let events: ServerResponse | undefined
    let submission: ServerResponse | undefined
    let output = ""
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      output += String(chunk)
      return true
    }) as any)
    const finalPart = {
      id: "prt_final",
      messageID: "msg_final",
      sessionID: "ses_goal_events",
      type: "text",
      text: "Permission rejected; alternative work finished",
      time: { start: 1, end: 2 },
    }
    let rejected = false
    let eventClosed = false
    const sessionID = "ses_goal_events"
    const emit = (type: string, properties: unknown) =>
      events!.write(`data: ${JSON.stringify({ type, properties })}\n\n`)
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/event")) {
        events = response
        response.writeHead(200, { "content-type": "text/event-stream" })
        emit("server.connected", {})
        response.on("close", () => {
          eventClosed = true
        })
        return
      }
      response.setHeader("content-type", "application/json")
      if (request.url === "/session" && request.method === "POST") {
        response.end(JSON.stringify({ id: sessionID }))
        return
      }
      if (request.method === "POST" && /\/(command|message)$/.test(request.url ?? "")) {
        submission = response
        emit("session.status", { sessionID, status: { type: "idle" } })
        emit("session.status", { sessionID, status: { type: "busy" } })
        emit("permission.asked", {
          id: "per_goal_events",
          sessionID,
          permission: "external_directory",
          patterns: ["/outside/fixture"],
          always: [],
          metadata: {},
        })
        return
      }
      if (request.url === "/permission/per_goal_events/reply") {
        let body = ""
        request.on("data", (chunk) => {
          body += chunk
        })
        request.on("end", () => {
          rejected = body.includes('"reply":"reject"')
          response.end("true")
          emit("message.part.updated", { part: finalPart })
          emit("session.status", { sessionID, status: { type: "idle" } })
          submission!.end(
            JSON.stringify({
              info: { id: "msg_final", sessionID, role: "assistant", time: { created: 1, completed: 2 } },
              parts: [finalPart],
            }),
          )
        })
        return
      }
      response.end("[]")
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    let deadlineFired = false
    const deadline = setTimeout(() => {
      deadlineFired = true
      server.closeAllConnections()
    }, 2000)
    try {
      await RunCommand.handler({
        message: ["Finish goal"],
        command,
        "--": [],
        attach: `http://127.0.0.1:${address.port}`,
        format: "json",
      } as never)
      expect(deadlineFired).toBe(false)
      expect(rejected).toBe(true)
      // Once in the text event, once embedded in the terminal result line.
      expect(output.match(/Permission rejected; alternative work finished/g)).toHaveLength(2)
      // The run's only interaction was a denied permission and no mutation
      // ever completed: blocked, exit 3.
      expect(process.exitCode).toBe(3)
      await expect.poll(() => eventClosed).toBe(true)
    } finally {
      clearTimeout(deadline)
      write.mockRestore()
      process.exitCode = previousExitCode
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)

test.each([false, true])(
  "headless control response preserves final text and errors without idle: %s",
  async (failed) => {
    const previousExitCode = process.exitCode
    let closed = false
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
          closed = true
        })
        return
      }
      response.setHeader("content-type", "application/json")
      if (request.url === "/session") response.end(JSON.stringify({ id: "ses_goal_control" }))
      else if (request.url?.endsWith("/command"))
        response.end(
          JSON.stringify({
            info: {
              id: "msg_control",
              sessionID: "ses_goal_control",
              role: "assistant",
              time: { created: 1, completed: 2 },
              ...(failed ? { error: { name: "UnknownError", data: { message: "Goal execution failed" } } } : {}),
            },
            parts: [
              {
                id: "prt_control",
                sessionID: "ses_goal_control",
                messageID: "msg_control",
                type: "text",
                text: "Current goal is paused",
              },
            ],
          }),
        )
      else response.end("[]")
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    let deadlineFired = false
    const deadline = setTimeout(() => {
      deadlineFired = true
      server.closeAllConnections()
    }, 2000)
    try {
      await RunCommand.handler({
        message: [],
        command: "goal",
        "--": [],
        attach: `http://127.0.0.1:${address.port}`,
        format: "json",
      } as never)
      // A forced test timeout must never be mistaken for normal completion.
      expect(deadlineFired).toBe(false)
      expect(output).toContain("Current goal is paused")
      if (failed) {
        expect(output).toContain("Goal execution failed")
        expect(process.exitCode).toBe(1)
      }
      await expect.poll(() => closed).toBe(true)
    } finally {
      clearTimeout(deadline)
      write.mockRestore()
      process.exitCode = previousExitCode
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)
