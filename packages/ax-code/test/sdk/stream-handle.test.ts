import { expect, test } from "vitest"
import type { RunResult, StreamEvent } from "@ax-code/sdk/programmatic"
import { createStreamHandle } from "../../src/sdk/programmatic-impl"

const result = { text: "Hello world" } as RunResult

async function* source(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event
}

const doneEvents = (): StreamEvent[] => [
  { type: "text", text: "Hello " },
  { type: "text", text: "world" },
  { type: "done", result },
]

test("concurrent text() and result() both see the final result", async () => {
  const handle = createStreamHandle(source(doneEvents()))
  const [text, final] = await Promise.all([handle.text(), handle.result()])
  expect(text).toBe("Hello world")
  expect(final.text).toBe("Hello world")
})

test("text() after done() with callbacks returns the final text", async () => {
  const handle = createStreamHandle(source(doneEvents()))
  const chunks: string[] = []
  handle.on("text", (text) => chunks.push(text))
  await handle.done()
  expect(chunks.join("")).toBe("Hello world")
  expect(await handle.text()).toBe("Hello world")
  expect(await handle.text()).toBe("Hello world")
})

test("result() rejects with the stream's own error", async () => {
  const error = new Error("rate limited")
  const handle = createStreamHandle(source([{ type: "error", error }]))
  await expect(handle.result()).rejects.toBe(error)
})
