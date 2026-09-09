import { createServer } from "node:http"
import { once } from "node:events"
import { expect, test } from "vitest"
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
