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

test("programmatic agent stream does not mark initialization started before it succeeds", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/sdk/programmatic.ts")).text()
  const start = src.indexOf("stream(message: string, runOptions?: RunOptions): StreamHandle")
  const end = src.indexOf("async session(): Promise<SessionHandle>", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = src.slice(start, end)

  const createSession = block.indexOf('sessionID = await createTrackedSession("create")')
  const createIterator = block.indexOf("[Symbol.asyncIterator]()", createSession)
  const markStarted = block.indexOf("started = true")
  expect(createSession).toBeGreaterThan(-1)
  expect(createIterator).toBeGreaterThan(createSession)
  expect(markStarted).toBeGreaterThan(createIterator)
  expect(block).toContain("} catch (error) {")
  expect(block).toContain("releaseSession()")
  expect(block.indexOf("releaseSession()")).toBeGreaterThan(block.indexOf("} catch (error) {"))
})

test("programmatic agent run aborts the session on outer timeout", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/sdk/programmatic.ts")).text()
  const start = src.indexOf("async run(message: string, runOptions?: RunOptions): Promise<RunResult>")
  const end = src.indexOf("stream(message: string, runOptions?: RunOptions): StreamHandle", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = src.slice(start, end)

  expect(block).toContain("let sessionID: string | undefined")
  expect(block).toContain('sessionID = await createTrackedSession("create")')
  expect(block).toContain("sessionID = undefined")
  expect(block).toContain("if (sessionID) void sdk.session.abort({ sessionID }).catch(() => {})")
})
