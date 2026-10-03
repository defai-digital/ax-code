import { afterEach, expect, test, vi } from "vitest"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { SessionStatus } from "../../src/session/status"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { WikiAutomatic } from "../../src/wiki/automatic"
import { readWikiFailureMemory } from "../../src/wiki/failure-memory"
import { wikiProjectRoot } from "../../src/wiki/root"
import { tmpdir } from "../fixture/fixture"

const state = vi.hoisted(() => ({
  build: vi.fn(async (_input: { root: string; signal: AbortSignal; includeGraphEvidence: boolean }) => {}),
}))
vi.mock("../../src/wiki/native", async (load) => ({
  ...(await load<typeof import("../../src/wiki/native")>()),
  runNativeWiki: state.build,
}))
afterEach(async () => {
  await Instance.disposeAll()
  vi.restoreAllMocks()
  state.build.mockReset()
  state.build.mockResolvedValue(undefined)
})
const waitForBuildCalls = (calls: number) =>
  vi.waitFor(() => expect(state.build).toHaveBeenCalledTimes(calls), { timeout: 15_000, interval: 25 })
const waitForStatus = (expected: Partial<ReturnType<typeof WikiAutomatic.status>>) =>
  vi.waitFor(() => expect(WikiAutomatic.status()).toMatchObject(expected), { timeout: 15_000, interval: 25 })

test("explicit requests share worktree root, join running builds and honor readonly agents", async () => {
  await using tmp = await tmpdir({ git: true })
  const nested = path.join(tmp.path, "packages", "unit")
  await mkdir(nested, { recursive: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": name === "plan" ? "deny" : "allow" }),
  }))
  let complete!: () => void
  let started!: () => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  state.build.mockImplementationOnce(async () => {
    started()
    await new Promise<void>((resolve) => {
      complete = resolve
    })
  })
  await Instance.provide({
    directory: nested,
    fn: async () => {
      expect(await wikiProjectRoot()).toBe(tmp.path)
      expect(WikiAutomatic.status().phase).toBe("disabled")
      await WikiAutomatic.refresh("build")
      await begun
      expect(state.build).toHaveBeenCalledTimes(1)
      expect(state.build.mock.calls[0][0]).toMatchObject({
        root: tmp.path,
        dir: ".ax-wiki",
        includeGraphEvidence: false,
      })
      await WikiAutomatic.refresh("build")
      expect(state.build).toHaveBeenCalledTimes(1)
      expect(state.build.mock.calls[0][0].signal.aborted).toBe(false)
      complete()
      await waitForStatus({ phase: "ready" })
      await WikiAutomatic.refresh("plan")
      await waitForStatus({ phase: "disabled", reason: "permissions" })
      expect(state.build).toHaveBeenCalledTimes(1)
    },
  })
})
test("busy and retry session status blocks explicit maintenance until idle", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = SessionID.make("wiki-fixture")
      await SessionStatus.set(id, { type: "retry", attempt: 1, message: "Fixture", next: Date.now() + 1000 })
      await WikiAutomatic.refresh("build")
      await waitForStatus({ phase: "queued", reason: "busy" })
      expect(state.build).not.toHaveBeenCalled()
      await SessionStatus.set(id, { type: "idle" })
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(1)
    },
  })
})

test("a pending interactive registration cannot create jobs after instance disposal", async () => {
  await using tmp = await tmpdir({ git: true })
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => {
    started()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return { name, mode: "primary", native: true, options: {}, permission: Permission.fromConfig({ "*": "allow" }) }
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pending = WikiAutomatic.enable("build")
      await entered
      await Instance.dispose()
      release()
      expect((await pending).phase).toBe("disabled")
      expect(state.build).not.toHaveBeenCalled()
    },
  })
})
test("a non-empty interactive draft blocks even explicit refresh", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await WikiAutomatic.enable("build", true)
      await WikiAutomatic.refresh("build")
      await waitForStatus({ reason: "busy" })
      expect(state.build).not.toHaveBeenCalled()
      await WikiAutomatic.enable("build", false)
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(1)
    },
  })
})

test("deleting a busy session releases its project maintenance blocker", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await WikiAutomatic.enable("build")
      const session = await Session.create({})
      await SessionStatus.set(session.id, { type: "busy" })
      await waitForStatus({ reason: "busy" })
      await WikiAutomatic.refresh("build")
      expect(state.build).not.toHaveBeenCalled()
      await Session.remove(session.id)
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(1)
    },
  })
})
test("registration carries the invoking session through to generation", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      await WikiAutomatic.enable("build", false, session.id)
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(1)
      // Refresh without a session keeps the registered one.
      expect(state.build.mock.calls[0][0]).toMatchObject({ sessionID: session.id })
      const other = await Session.create({})
      await WikiAutomatic.refresh("build", false, other.id)
      await waitForBuildCalls(2)
      expect(state.build.mock.calls[1][0]).toMatchObject({ sessionID: other.id })
    },
  })
})

test("records a durable failure memory when a maintenance build fails", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  }))
  state.build.mockRejectedValueOnce(new Error("deterministic failure"))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(1)
      await vi.waitFor(
        async () => {
          expect(await readWikiFailureMemory(tmp.path, ".ax-wiki")).toMatchObject({
            consecutiveFailures: 1,
            error: expect.stringContaining("deterministic failure"),
          })
        },
        { timeout: 15_000, interval: 25 },
      )
    },
  })

  const memory = await readWikiFailureMemory(tmp.path, ".ax-wiki")
  expect(memory?.consecutiveFailures).toBe(1)
  expect(memory?.error).toContain("deterministic failure")
  expect(memory?.lastHead).toBeTruthy()
})

test("an explicit request still runs while a failure cooldown is active", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(Agent, "get").mockImplementation(async (name) => ({
    name,
    mode: "primary",
    native: true,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  }))
  state.build.mockRejectedValueOnce(new Error("deterministic failure"))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(1)
      await vi.waitFor(async () => expect(await readWikiFailureMemory(tmp.path, ".ax-wiki")).toBeTruthy(), {
        timeout: 15_000,
        interval: 25,
      })
      // The cooldown exists, but a user-requested refresh must still run.
      state.build.mockResolvedValueOnce(undefined)
      await WikiAutomatic.refresh("build")
      await waitForBuildCalls(2)
      await vi.waitFor(async () => expect(await readWikiFailureMemory(tmp.path, ".ax-wiki")).toBeUndefined(), {
        timeout: 15_000,
        interval: 25,
      })
    },
  })
  // A successful build clears the memory again.
  expect(await readWikiFailureMemory(tmp.path, ".ax-wiki")).toBeUndefined()
})
