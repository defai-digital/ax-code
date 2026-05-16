import { expect, test } from "bun:test"
import path from "path"

test("programmatic stream removes abort listeners when prompt fails", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/sdk/programmatic.ts")).text()
  const start = src.indexOf("stream(message: string, options?: RunOptions): StreamHandle")
  const end = src.indexOf("async messages()", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = src.slice(start, end)

  expect(block).toContain('options?.signal?.addEventListener("abort", abort, { once: true })')
  expect(block).toContain("await sdk.session.prompt")
  expect(block).toContain("yield* streamEvents")
  expect(block).toContain('options?.signal?.removeEventListener("abort", abort)')
  expect(block.indexOf('options?.signal?.removeEventListener("abort", abort)')).toBeGreaterThan(
    block.indexOf("finally {"),
  )
})

test("programmatic agent dispose aborts sessions created by the agent", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/sdk/programmatic.ts")).text()
  const start = src.indexOf("export async function createAgent(")
  const end = src.indexOf("async dispose()", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const createAgentBody = src.slice(start, end)

  expect(createAgentBody).toContain("const activeSessions = new Set<string>()")
  expect(createAgentBody).toContain("const abortActiveSessions = async () => {")
  expect(createAgentBody).toContain("sdk.session.abort({ sessionID })")
  expect(src.slice(end, src.indexOf("}", end) + 1)).toContain("await abortActiveSessions()")
})
