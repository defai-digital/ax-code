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
const wait = () => new Promise((resolve) => setTimeout(resolve, 30))

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
      expect(state.build.mock.calls[0][0]).toMatchObject({ root: tmp.path, includeGraphEvidence: false })
      await WikiAutomatic.refresh("build")
      expect(state.build).toHaveBeenCalledTimes(1)
      expect(state.build.mock.calls[0][0].signal.aborted).toBe(false)
      complete()
      await wait()
      expect(WikiAutomatic.status().phase).toBe("ready")
      await WikiAutomatic.refresh("plan")
      await wait()
      expect(WikiAutomatic.status()).toMatchObject({ phase: "disabled", reason: "permissions" })
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
      await wait()
      expect(WikiAutomatic.status()).toMatchObject({ phase: "queued", reason: "busy" })
      expect(state.build).not.toHaveBeenCalled()
      await SessionStatus.set(id, { type: "idle" })
      await WikiAutomatic.refresh("build")
      await wait()
      expect(state.build).toHaveBeenCalledTimes(1)
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
      await wait()
      expect(state.build).not.toHaveBeenCalled()
      expect(WikiAutomatic.status().reason).toBe("busy")
      await WikiAutomatic.enable("build", false)
      await WikiAutomatic.refresh("build")
      await wait()
      expect(state.build).toHaveBeenCalledTimes(1)
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
      await wait()
      await WikiAutomatic.refresh("build")
      await wait()
      expect(state.build).not.toHaveBeenCalled()
      await Session.remove(session.id)
      await wait()
      await WikiAutomatic.refresh("build")
      await wait()
      expect(state.build).toHaveBeenCalledTimes(1)
    },
  })
})
