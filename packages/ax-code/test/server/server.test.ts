import { expect, test } from "bun:test"
import { Server } from "../../src/server/server"

test("cors uses the bound port after --port=0 fallback", async () => {
  const previousUrl = (Server as any).url
  ;(Server as any).url = new URL("http://localhost:52134")

  try {
    const app = Server.createApp({ port: 0 })
    const response = await app.fetch(
      new Request("http://localhost:52134/not-found", {
        headers: {
          origin: "http://localhost:52134",
        },
      }),
    )

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:52134")
  } finally {
    ;(Server as any).url = previousUrl
  }
})
