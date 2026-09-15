import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Global } from "../../src/global"
import * as Git from "../../src/util/git"
import { tmpdir } from "../fixture/fixture"
import * as Retention from "../../src/snapshot/retention"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
  vi.unstubAllEnvs()
})

test.each(["restore", "revert"] as const)(
  "%s serializes with tracking from another directory instance (#458)",
  async (operation) => {
    await using tmp = await tmpdir({ git: true })
    const a = path.join(tmp.path, "a"),
      b = path.join(tmp.path, "b")
    await fs.mkdir(a)
    await fs.mkdir(b)
    const file = path.join(tmp.path, "state.txt")
    await fs.writeFile(file, "original")
    const first = await Instance.provide({ directory: a, fn: () => Snapshot.track() })
    await fs.writeFile(file, "changed")
    // Initialize the other instance before the controlled interleaving.
    await Instance.provide({ directory: b, fn: () => Snapshot.init() })
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>()
    const original = Git.git
    let paused = false
    vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
      const result = await original(args, opts)
      if (!paused && args.includes(operation === "restore" ? "read-tree" : "checkout") && args.includes(first!)) {
        paused = true
        entered.resolve()
        await release.promise
      }
      return result
    })
    const restore = Instance.provide({
      directory: a,
      fn: () =>
        operation === "restore" ? Snapshot.restore(first!) : Snapshot.revert([{ hash: first!, files: [file] }]),
    })
    let tracking: Promise<string | undefined> | undefined
    try {
      await entered.promise
      const pending = (async () => await Instance.provide({ directory: b, fn: () => Snapshot.track() }))()
      tracking = pending
      const result = await Promise.race([
        pending.then(() => "finished"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 100)),
      ])
      expect(result).toBe("waiting")
    } finally {
      release.resolve()
      await restore
      await tracking
    }
    expect(await tracking).toBe(first)
    expect(await fs.readFile(file, "utf8")).toBe("original")
  },
  60_000,
)

test.each([false, true])(
  "cleanup preserves all retained reference kinds (sharded=%s) (#456)",
  async (sharded) => {
    vi.stubEnv("AX_CODE_SHARD_SESSIONS", sharded ? "1" : "0")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "state.txt")
        const hashes: string[] = []
        for (const value of ["start", "finish", "patch", "undo", "unreferenced", "current"]) {
          await fs.writeFile(file, value)
          hashes.push((await Snapshot.track())!)
        }
        const session = await Session.create({})
        const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        const message = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          agent: "default",
          mode: "default",
          path: { cwd: tmp.path, root: tmp.path },
          tokens,
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
          parentID: MessageID.ascending(),
          time: { created: Date.now() },
        })
        const part = () => ({ id: PartID.ascending(), sessionID: session.id, messageID: message.id })
        await Session.updatePart({ ...part(), type: "step-start", snapshot: hashes[0] })
        await Session.updatePart({ ...part(), type: "step-finish", snapshot: hashes[1], reason: "stop", tokens })
        await Session.updatePart({ ...part(), type: "patch", hash: hashes[2], files: [file] })
        await Session.setRevert({ sessionID: session.id, revert: { messageID: message.id, snapshot: hashes[3] } })
        const gitdir = path.join(Global.Path.data, "snapshot", Instance.project.id)
        const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        for (const hash of hashes)
          await fs.writeFile(path.join(gitdir, "ax-code", "snapshots", hash), String(expired.getTime()))
        // Simulate a ref removed by an older version, with the object still present.
        expect(
          (await Git.git(["--git-dir", gitdir, "update-ref", "-d", `refs/snapshots/${hashes[0]}`], { cwd: tmp.path }))
            .exitCode,
        ).toBe(0)
        for (const dir of await fs.readdir(path.join(gitdir, "objects"))) {
          if (!/^[0-9a-f]{2}$/.test(dir)) continue
          for (const name of await fs.readdir(path.join(gitdir, "objects", dir))) {
            await fs.utimes(path.join(gitdir, "objects", dir, name), expired, expired)
          }
        }
        await Snapshot.cleanup()
        for (const hash of [...hashes.slice(0, 4), hashes[5]]) {
          expect((await Git.git(["--git-dir", gitdir, "cat-file", "-e", hash], { cwd: tmp.path })).exitCode).toBe(0)
        }
        expect(
          (await Git.git(["--git-dir", gitdir, "cat-file", "-e", hashes[4]], { cwd: tmp.path })).exitCode,
        ).not.toBe(0)
        expect((await Session.get(session.id)).id).toBe(session.id)
        await Snapshot.revert([{ hash: hashes[0], files: [file] }])
        expect(await fs.readFile(file, "utf8")).toBe("start")
      },
    })
  },
  60_000,
)

test("cleanup skips destructive work if retained references cannot be read (#456)", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const original = Git.git
      const commands: string[][] = []
      vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
        commands.push(args)
        return original(args, opts)
      })
      vi.spyOn(Retention, "retainedSnapshotHashes").mockImplementation(() => {
        throw new Error("unreadable shard")
      })
      await Snapshot.cleanup()
      expect(commands.some((args) => args.includes("gc") || args.includes("update-ref"))).toBe(false)
    },
  })
}, 60_000)

test("a failed operation releases the shared queue for another directory (#458)", async () => {
  await using tmp = await tmpdir({ git: true })
  const b = path.join(tmp.path, "b")
  await fs.mkdir(b)
  await Instance.provide({ directory: tmp.path, fn: () => Snapshot.track() })
  const original = Git.git
  let failed = false
  vi.spyOn(Git, "git").mockImplementation(async (args, opts) => {
    if (!failed && args.includes("write-tree")) {
      failed = true
      throw new Error("controlled Git failure")
    }
    return original(args, opts)
  })
  await fs.writeFile(path.join(tmp.path, "new.txt"), "new")
  await expect(Instance.provide({ directory: tmp.path, fn: () => Snapshot.track() })).rejects.toThrow(
    "controlled Git failure",
  )
  expect(await Instance.provide({ directory: b, fn: () => Snapshot.track() })).toMatch(/^[0-9a-f]{40}$/)
}, 60_000)
