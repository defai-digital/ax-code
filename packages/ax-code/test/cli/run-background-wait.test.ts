import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import { expect, test, vi } from "vitest"
import { RunCommand } from "../../src/cli/cmd/run"
import { parseJsonStrict } from "../../src/util/json-value"

test("headless run waits for its background handoff and reports the parent follow-up", async () => {
  const previousExitCode = process.exitCode
  const sessionID = "ses_background_wait"
  const taskID = "tsk_background_wait"
  let stream: ServerResponse | undefined
  let delivered = false
  let parentCompleted = false
  let output = ""
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as never)
  const foreground = {
    info: { id: "msg_foreground", sessionID, role: "assistant", time: { created: 1, completed: 2 } },
    parts: [{ id: "prt_foreground", messageID: "msg_foreground", sessionID, type: "text", text: "Child started" }],
  }
  const handoff = {
    info: { id: "msg_handoff", sessionID, role: "user", time: { created: 3 } },
    parts: [
      {
        id: "prt_handoff",
        messageID: "msg_handoff",
        sessionID,
        type: "text",
        text: "Child finished",
        synthetic: true,
        metadata: { source: "background_subagent_handoff", taskQueueID: taskID },
      },
    ],
  }
  const followup = {
    info: { id: "msg_followup", sessionID, role: "assistant", time: { created: 4, completed: 5 } },
    parts: [
      { id: "prt_followup", messageID: "msg_followup", sessionID, type: "text", text: "Integrated child result" },
    ],
  }
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/event")) {
      stream = response
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"server.connected","properties":{}}\n\n')
      return
    }
    response.setHeader("content-type", "application/json")
    if (request.url === "/session" && request.method === "POST")
      return void response.end(JSON.stringify({ id: sessionID }))
    if (request.url === `/session/${sessionID}/message` && request.method === "POST") {
      response.end(JSON.stringify(foreground))
      setTimeout(() => {
        delivered = true
        stream?.write(`data: ${JSON.stringify({ type: "message.updated", properties: { info: handoff.info } })}\n\n`)
        setTimeout(() => {
          parentCompleted = true
          stream?.write(`data: ${JSON.stringify({ type: "message.updated", properties: { info: followup.info } })}\n\n`)
        }, 150)
      }, 400)
      return
    }
    if (request.url?.startsWith("/task-queue")) {
      return void response.end(
        JSON.stringify([
          {
            id: taskID,
            kind: "subagent",
            status: delivered ? "completed" : "running",
            sessionID: "ses_child",
            title: "Background child",
            payload: {
              source: "task",
              parentSessionID: sessionID,
              deliveryStatus: delivered ? "delivered" : "pending",
            },
            time: { created: 3 },
          },
        ]),
      )
    }
    if (request.url === "/session/status") {
      return void response.end(
        JSON.stringify({ [sessionID]: { type: delivered && !parentCompleted ? "busy" : "idle" } }),
      )
    }
    if (request.url?.startsWith(`/session/${sessionID}/message`) && request.method === "GET") {
      return void response.end(
        JSON.stringify([foreground, ...(delivered ? [handoff] : []), ...(parentCompleted ? [followup] : [])]),
      )
    }
    response.end("[]")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server address")
  try {
    await RunCommand.handler({
      message: ["Use a background child"],
      "--": [],
      attach: `http://127.0.0.1:${address.port}`,
      format: "json",
      "await-background": 2,
    } as never)
    expect(parentCompleted).toBe(true)
    const results = output
      .split("\n")
      .filter(Boolean)
      .map((line) => parseJsonStrict(line) as { type?: string; text?: string })
      .filter((event) => event.type === "result")
    expect(results).toHaveLength(1)
    expect(results[0]?.text).toBe("Integrated child result")
    expect(process.exitCode).toBeUndefined()
  } finally {
    stdout.mockRestore()
    process.exitCode = previousExitCode
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("headless background deadline reports incomplete work once", async () => {
  const previousExitCode = process.exitCode
  const sessionID = "ses_background_stalled"
  let output = ""
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as never)
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/event")) {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"server.connected","properties":{}}\n\n')
      return
    }
    response.setHeader("content-type", "application/json")
    if (request.url === "/session" && request.method === "POST")
      return void response.end(JSON.stringify({ id: sessionID }))
    if (request.url === `/session/${sessionID}/message` && request.method === "POST") {
      return void response.end(
        JSON.stringify({
          info: { id: "msg_stalled", sessionID, role: "assistant", time: { created: 1, completed: 2 } },
          parts: [{ id: "prt_stalled", messageID: "msg_stalled", sessionID, type: "text", text: "Child started" }],
        }),
      )
    }
    if (request.url?.startsWith("/task-queue")) {
      return void response.end(
        JSON.stringify([
          {
            id: "tsk_stalled",
            kind: "subagent",
            status: "running",
            sessionID: "ses_child",
            title: "Stalled child",
            payload: { source: "task", parentSessionID: sessionID, deliveryStatus: "pending" },
            time: { created: 3 },
          },
        ]),
      )
    }
    if (request.url?.startsWith(`/session/${sessionID}/message`) && request.method === "GET")
      return void response.end("[]")
    response.end("[]")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server address")
  try {
    await RunCommand.handler({
      message: ["Use a background child"],
      "--": [],
      attach: `http://127.0.0.1:${address.port}`,
      format: "json",
      "await-background": 1,
    } as never)
    const lines = output
      .split("\n")
      .filter(Boolean)
      .map((line) => parseJsonStrict(line) as { type?: string; status?: string; error?: unknown })
    expect(lines.filter((line) => line.type === "result")).toHaveLength(1)
    expect(lines.at(-1)).toMatchObject({ type: "result", status: "error" })
    expect(
      lines.some(
        (line) =>
          line.type === "error" && String(JSON.stringify(line.error)).includes("Background work did not settle"),
      ),
    ).toBe(true)
    expect(process.exitCode).toBe(1)
  } finally {
    stdout.mockRestore()
    process.exitCode = previousExitCode
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("headless background deadline bounds a blocked task queue HTTP read", async () => {
  const previousExitCode = process.exitCode
  const sessionID = "ses_background_blocked_read"
  let output = ""
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as never)
  const foreground = {
    info: { id: "msg_blocked", sessionID, role: "assistant", time: { created: 1, completed: 2 } },
    parts: [{ id: "prt_blocked", messageID: "msg_blocked", sessionID, type: "text", text: "Child started" }],
  }
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/event")) {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"server.connected","properties":{}}\n\n')
      return
    }
    if (request.url?.startsWith("/task-queue")) return
    response.setHeader("content-type", "application/json")
    if (request.url === "/session" && request.method === "POST")
      return void response.end(JSON.stringify({ id: sessionID }))
    if (request.url === `/session/${sessionID}/message` && request.method === "POST")
      return void response.end(JSON.stringify(foreground))
    if (request.url?.startsWith(`/session/${sessionID}/message`) && request.method === "GET")
      return void response.end(JSON.stringify([foreground]))
    response.end("[]")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server address")
  try {
    const started = Date.now()
    await RunCommand.handler({
      message: ["Use a background child"],
      "--": [],
      attach: `http://127.0.0.1:${address.port}`,
      format: "json",
      "await-background": 1,
    } as never)
    expect(Date.now() - started).toBeLessThan(2500)
    const lines = output
      .split("\n")
      .filter(Boolean)
      .map((line) => parseJsonStrict(line) as { type?: string; status?: string; error?: unknown })
    expect(lines.filter((line) => line.type === "result")).toHaveLength(1)
    expect(lines.at(-1)).toMatchObject({ type: "result", status: "error" })
    expect(
      lines.some((line) => line.type === "error" && String(JSON.stringify(line.error)).includes("did not settle")),
    ).toBe(true)
    expect(process.exitCode).toBe(1)
  } finally {
    stdout.mockRestore()
    process.exitCode = previousExitCode
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test.each(["none", "automation"])("headless run does not wait for %s background work", async (kind) => {
  const previousExitCode = process.exitCode
  const sessionID = "ses_no_child"
  let output = ""
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as never)
  const foreground = {
    info: { id: "msg_no_child", sessionID, role: "assistant", time: { created: 1, completed: 2 } },
    parts: [{ id: "prt_no_child", messageID: "msg_no_child", sessionID, type: "text", text: "Done" }],
  }
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/event")) {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"server.connected","properties":{}}\n\n')
      return
    }
    response.setHeader("content-type", "application/json")
    if (request.url === "/session" && request.method === "POST")
      return void response.end(JSON.stringify({ id: sessionID }))
    if (request.url === `/session/${sessionID}/message` && request.method === "POST")
      return void response.end(JSON.stringify(foreground))
    if (request.url?.startsWith("/task-queue"))
      return void response.end(
        JSON.stringify(
          kind === "automation"
            ? [
                {
                  id: "tsk_automation",
                  kind: "automation",
                  status: "running",
                  payload: { parentSessionID: sessionID },
                  time: { created: Date.now() },
                },
              ]
            : [],
        ),
      )
    if (request.url?.startsWith(`/session/${sessionID}/message`) && request.method === "GET")
      return void response.end(JSON.stringify([foreground]))
    response.end("[]")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing server address")
  try {
    const started = Date.now()
    await RunCommand.handler({
      message: ["Finish without a child"],
      "--": [],
      attach: `http://127.0.0.1:${address.port}`,
      format: "json",
      "await-background": 2,
    } as never)
    expect(Date.now() - started).toBeLessThan(1500)
    const results = output
      .split("\n")
      .filter(Boolean)
      .map((line) => parseJsonStrict(line) as { type?: string; text?: string })
      .filter((event) => event.type === "result")
    expect(results).toHaveLength(1)
    expect(results[0]?.text).toBe("Done")
    expect(process.exitCode).toBeUndefined()
  } finally {
    stdout.mockRestore()
    process.exitCode = previousExitCode
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
