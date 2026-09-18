import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { FixedContextError } from "../../src/provider/fixed-context"

const state = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock("../../src/provider/fixed-context-operation", async (load) => ({
  ...(await load<typeof import("../../src/provider/fixed-context-operation")>()),
  askFixedContext: state.run,
}))
const input = { files: ["value.py"], question: "What does this return?", providerID: "trust", modelID: "model" }
const output = { answer: "43", cache: { status: "HIT" }, contextDigest: "hash", providerID: "trust", modelID: "model" }
beforeEach(() => {
  state.run.mockReset()
  state.run.mockResolvedValue(output)
})
afterEach(async () => {
  await Instance.disposeAll()
})

async function request(directory: string, body: unknown, signal?: AbortSignal) {
  return Server.Default().request(`/experimental/fixed-context?directory=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
}

test("HTTP questions use the selected server directory and expose real result metadata", async () => {
  await using tmp = await tmpdir({ git: true })
  const response = await request(tmp.path, input)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(output)
  expect(state.run.mock.calls[0]?.[1]).toBe(tmp.path)
  expect(state.run.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
})

test("HTTP rejects extra history, tools, directory overrides and out-of-bounds requests before execution", async () => {
  await using tmp = await tmpdir({ git: true })
  for (const extra of [{ tools: [] }, { messages: [] }, { directory: "/other" }, { files: [] }, { maxTokens: 4097 }]) {
    const response = await request(tmp.path, { ...input, ...extra })
    expect(response.status).toBe(400)
  }
  expect(state.run).not.toHaveBeenCalled()
})

test("read permission failures stay actionable HTTP errors", async () => {
  await using tmp = await tmpdir({ git: true })
  state.run.mockRejectedValue(new FixedContextError({ message: "Read permission is not allowed for a selected file." }))
  const response = await request(tmp.path, input)
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ message: "Read permission is not allowed for a selected file." })
})

test("HTTP cancellation reaches the shared operation", async () => {
  await using tmp = await tmpdir({ git: true })
  const started = Promise.withResolvers<AbortSignal>()
  state.run.mockImplementation(async (_input, _directory, signal: AbortSignal) => {
    started.resolve(signal)
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
    throw new FixedContextError({ message: "Cancelled." })
  })
  const abort = new AbortController()
  const pending = request(tmp.path, input, abort.signal)
  const signal = await started.promise
  abort.abort()
  expect(signal.aborted).toBe(true)
  expect((await pending).status).toBe(400)
})
