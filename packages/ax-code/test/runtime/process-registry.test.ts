import { describe, expect, test } from "vitest"
import fsp from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { ProcessRegistry } from "../../src/runtime/process-registry"
import { tmpdir } from "../fixture/fixture"

const LIVE_OWNER_PID = 4242
// depsFor's default probe answers `start-<pid>`; the live-owner fixture
// must match it so the owner identity check passes.
const LIVE_OWNER_START = `start-${LIVE_OWNER_PID}`

type SignalCall = { target: number; signal: NodeJS.Signals }

function depsFor(
  dir: string,
  opts: { alive?: number[]; starts?: Record<number, string | undefined>; ownerStartOverride?: string } = {},
) {
  const signals: SignalCall[] = []
  const alive = new Set(opts.alive ?? [])
  const deps: ProcessRegistry.Deps = {
    dir,
    platform: "darwin",
    now: () => 1_000,
    isAlive: (pid) => alive.has(pid),
    readStartTime: (pid) => (pid in (opts.starts ?? {}) ? opts.starts![pid] : `start-${pid}`),
    signal: (target, signal) => signals.push({ target, signal }),
    sleep: async () => {},
  }
  return { deps, signals }
}

async function writeEntry(
  dir: string,
  entry: Partial<ProcessRegistry.Entry> & { pid: number; kind: ProcessRegistry.Kind },
) {
  const full = {
    pgid: entry.pid,
    startedAt: `start-${entry.pid}`,
    ownerPid: LIVE_OWNER_PID,
    ownerStartedAt: LIVE_OWNER_START,
    commandBase: "sleep",
    ...entry,
  }
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${full.kind}-${full.pid}.json`)
  await fsp.writeFile(file, JSON.stringify(full, null, 2))
  return { file, entry: full as ProcessRegistry.Entry }
}

describe("ProcessRegistry.register", () => {
  test("writes one record per child with identity and a basename-only command", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")

    await ProcessRegistry.register(
      { pid: 555, pgid: 555, kind: "shell", command: "cargo build --release" },
      { ...depsFor(dir).deps, owner: { pid: 100, startedAt: "owner-100" }, readStartTime: () => "child-555-start" },
    )

    const file = path.join(dir, "shell-555.json")
    const raw = JSON.parse(await fsp.readFile(file, "utf-8"))
    expect(raw).toEqual({
      pid: 555,
      pgid: 555,
      kind: "shell",
      startedAt: "child-555-start",
      ownerPid: 100,
      ownerStartedAt: "owner-100",
      commandBase: "cargo",
    })
  })

  test("records pgid 0 when the child is not a group leader", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")

    await ProcessRegistry.register(
      { pid: 556, kind: "mcp", command: "/usr/local/bin/node" },
      { dir, platform: "darwin", owner: { pid: 100, startedAt: "owner-100" }, readStartTime: () => undefined },
    )

    const raw = JSON.parse(await fsp.readFile(path.join(dir, "mcp-556.json"), "utf-8"))
    expect(raw.pgid).toBe(0)
    expect(raw.startedAt).toBeNull()
    expect(raw.commandBase).toBe("node")
  })

  test("keeps basename extraction argument-free", () => {
    expect(ProcessRegistry.commandBase("sh -c 'rm -rf /tmp/x'")).toBe("sh")
    expect(ProcessRegistry.commandBase("  /opt/homebrew/bin/zsh --login  ")).toBe("zsh")
    expect(ProcessRegistry.commandBase("")).toBe("unknown")
  })

  test("never throws when the registry directory cannot be created", async () => {
    await expect(
      ProcessRegistry.register(
        { pid: 557, kind: "lsp", command: "clangd" },
        { dir: "/dev/null/ax-code-processes", platform: "darwin", owner: { pid: 100, startedAt: "o" } },
      ),
    ).resolves.toBeUndefined()
  })

  test("writes nothing on windows", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")

    await ProcessRegistry.register(
      { pid: 558, kind: "shell", command: "echo" },
      { dir, platform: "win32", owner: { pid: 100, startedAt: "o" } },
    )

    await expect(fsp.stat(dir)).rejects.toMatchObject({ code: "ENOENT" })
  })
})

describe("ProcessRegistry.unregister", () => {
  test("removes the entry and tolerates unknown pids", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 777, kind: "shell" })

    await ProcessRegistry.unregister(777, "shell", { dir })
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(ProcessRegistry.unregister(99999, "shell", { dir })).resolves.toBeUndefined()
  })
})

test("Wiki worker entries participate in identity-verified orphan sweeping", async () => {
  await using tmp = await tmpdir()
  const { deps, signals } = depsFor(tmp.path, { alive: [777] })
  await writeEntry(tmp.path, { pid: 777, pgid: 0, kind: "wiki" })
  const report = await ProcessRegistry.sweepOrphans(deps)
  expect(report.killed).toBe(1)
  expect(signals[0]).toEqual({ target: 777, signal: "SIGTERM" })
})

describe("ProcessRegistry.sweepOrphans", () => {
  test("keeps entries of live owners untouched", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 777, kind: "shell" })
    const { deps, signals } = depsFor(dir, { alive: [LIVE_OWNER_PID, 777] })

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, keptLiveOwner: 1, killed: 0 })
    expect(signals).toEqual([])
    expect((await fsp.stat(file)).isFile()).toBe(true)
  })

  test("treats an alive owner with a different start time as gone", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    // Child already dead, so the entry is only cleaned up — never signalled.
    const { file } = await writeEntry(dir, { pid: 777, kind: "shell" })
    const { deps, signals } = depsFor(dir, {
      alive: [LIVE_OWNER_PID],
      starts: { [LIVE_OWNER_PID]: "reused-owner-start" },
    })

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, alreadyDead: 1 })
    expect(signals).toEqual([])
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("removes dead-owner dead-child entries without signalling", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 778, kind: "mcp" })
    const { deps, signals } = depsFor(dir)

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, alreadyDead: 1, killed: 0 })
    expect(signals).toEqual([])
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("never signals a pid whose recorded start time does not match", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 779, kind: "lsp", startedAt: "recorded-long-ago" })
    const { deps, signals } = depsFor(dir, { alive: [779] })

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, pidReused: 1, killed: 0 })
    expect(signals).toEqual([])
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("never signals a child whose identity was never captured", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 780, kind: "shell", startedAt: null })
    const { deps, signals } = depsFor(dir, { alive: [780] })

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, unverified: 1, killed: 0 })
    expect(signals).toEqual([])
    expect((await fsp.stat(file)).isFile()).toBe(true)
  })

  test("never signals a live child whose start time cannot be read", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 781, kind: "mcp" })
    const { deps, signals } = depsFor(dir, { alive: [781], starts: { 781: undefined } })

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, unverified: 1, killed: 0 })
    expect(signals).toEqual([])
    expect((await fsp.stat(file)).isFile()).toBe(true)
  })

  test("SIGTERMs a verified orphan group and escalates to SIGKILL", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const { file } = await writeEntry(dir, { pid: 782, kind: "shell", pgid: 782 })
    const { deps, signals } = depsFor(dir, { alive: [782] })

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report).toMatchObject({ checked: 1, killed: 1 })
    expect(signals).toEqual([
      { target: -782, signal: "SIGTERM" },
      { target: 782, signal: "SIGTERM" },
      { target: -782, signal: "SIGKILL" },
      { target: 782, signal: "SIGKILL" },
    ])
    await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("skips SIGKILL when SIGTERM suffices", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    await writeEntry(dir, { pid: 783, kind: "shell", pgid: 783 })
    const base = depsFor(dir, { alive: [783] })
    let childAlive = true
    base.deps.signal = (target, signal) => {
      base.signals.push({ target, signal })
      if (signal === "SIGTERM") childAlive = false
    }
    base.deps.isAlive = (pid) => pid === 783 && childAlive

    const report = await ProcessRegistry.sweepOrphans(base.deps)

    expect(report).toMatchObject({ killed: 1 })
    expect(base.signals).toEqual([
      { target: -783, signal: "SIGTERM" },
      { target: 783, signal: "SIGTERM" },
    ])
  })

  test("signals only the pid when the child is not a group leader", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    await writeEntry(dir, { pid: 784, kind: "mcp", pgid: 0 })
    const { deps, signals } = depsFor(dir, { alive: [784] })

    await ProcessRegistry.sweepOrphans(deps)

    expect(signals).toEqual([
      { target: 784, signal: "SIGTERM" },
      { target: 784, signal: "SIGKILL" },
    ])
  })

  test("is a no-op on windows", async () => {
    await using tmp = await tmpdir()
    const { deps, signals } = depsFor(path.join(tmp.path, "processes"))
    await writeEntry(path.join(tmp.path, "processes"), { pid: 785, kind: "shell" })

    const report = await ProcessRegistry.sweepOrphans({ ...deps, platform: "win32" })

    expect(report).toMatchObject({ skipped: "non-posix", checked: 0 })
    expect(signals).toEqual([])
  })

  test("removes unparseable entry files and reports them", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    await fsp.mkdir(dir, { recursive: true })
    const garbage = path.join(dir, "shell-not-json.json")
    await fsp.writeFile(garbage, "{not json")
    const { deps, signals } = depsFor(dir)

    const report = await ProcessRegistry.sweepOrphans(deps)

    expect(report.invalidRemoved).toBe(1)
    expect(signals).toEqual([])
    await expect(fsp.stat(garbage)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("records the last sweep for doctor", async () => {
    ProcessRegistry.resetForTests()
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    await writeEntry(dir, { pid: 786, kind: "shell" })
    const { deps } = depsFor(dir, { alive: [LIVE_OWNER_PID, 786] })

    expect(ProcessRegistry.lastSweepReport()).toBeUndefined()
    await ProcessRegistry.sweepOrphans(deps)

    expect(ProcessRegistry.lastSweepReport()).toMatchObject({
      at: 1_000,
      report: { checked: 1, keptLiveOwner: 1 },
    })
    ProcessRegistry.resetForTests()
    expect(ProcessRegistry.lastSweepReport()).toBeUndefined()
  })
})

describe("ProcessRegistry.list", () => {
  test("computes per-entry states without mutating anything", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    await writeEntry(dir, { pid: 900, kind: "shell" })
    await writeEntry(dir, { pid: 901, kind: "lsp", ownerPid: 5150, ownerStartedAt: "gone-5150" })
    await writeEntry(dir, { pid: 902, kind: "mcp", ownerPid: 5150, ownerStartedAt: "gone-5150" })
    await writeEntry(dir, {
      pid: 903,
      kind: "shell",
      ownerPid: 5150,
      ownerStartedAt: "gone-5150",
      startedAt: "reused",
    })
    await writeEntry(dir, {
      pid: 904,
      kind: "shell",
      ownerPid: 5150,
      ownerStartedAt: "gone-5150",
      startedAt: null,
    })
    const { deps } = depsFor(dir, { alive: [LIVE_OWNER_PID, 901, 903, 904] })

    const listed = await ProcessRegistry.list(deps)

    expect(new Map(listed.map((item) => [item.entry.pid, item.state]))).toEqual(
      new Map([
        [900, "live-owner"],
        [901, "orphan"],
        [902, "dead"],
        [903, "pid-reused"],
        [904, "unverified"],
      ]),
    )
  })
})

// Real-signal tests: spawn harmless `sleep 30` children detached (their own
// process group), point the registry at a tmp directory, and let the sweep
// use the real signals and liveness checks. The identity probe is injected
// with a stable token: this sandbox denies spawning `ps` (spawn EPERM), so
// the default macOS probe is unavailable here — the mismatch (pid-reuse)
// behaviour is what the probe feeds, not the probe itself.
const describePosix = process.platform === "win32" ? describe.skip : describe

describePosix("ProcessRegistry.sweepOrphans against real processes", () => {
  async function deadOwnerPid(): Promise<number> {
    const dead = spawn("true", { stdio: "ignore" })
    await new Promise<void>((resolve) => {
      dead.once("exit", () => resolve())
    })
    return dead.pid!
  }

  test("kills a verified orphan and removes its entry", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const ownerPid = await deadOwnerPid()
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" })
    child.unref()
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    try {
      const file = path.join(dir, `shell-${child.pid}.json`)
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(
        file,
        JSON.stringify({
          pid: child.pid,
          pgid: child.pid,
          kind: "shell",
          startedAt: "spawn-token",
          ownerPid,
          ownerStartedAt: "dead-owner-start",
          commandBase: "sleep",
        }),
      )

      const report = await ProcessRegistry.sweepOrphans({
        dir,
        readStartTime: (pid) => (pid === child.pid ? "spawn-token" : undefined),
      })

      expect(report).toMatchObject({ checked: 1, killed: 1, unverified: 0, pidReused: 0 })
      await exited
      await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      try {
        process.kill(-child.pid!, "SIGKILL")
      } catch {
        // Already gone.
      }
    }
  })

  test("does not kill a live pid whose recorded start time differs (pid reuse)", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "processes")
    const ownerPid = await deadOwnerPid()
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" })
    child.unref()
    try {
      const file = path.join(dir, `shell-${child.pid}.json`)
      await fsp.mkdir(dir, { recursive: true })
      await fsp.writeFile(
        file,
        JSON.stringify({
          pid: child.pid,
          pgid: child.pid,
          kind: "shell",
          // A start time from an unrelated earlier process that owned this pid.
          startedAt: "Mon Jan  1 00:00:00 1970",
          ownerPid,
          ownerStartedAt: "dead-owner-start",
          commandBase: "sleep",
        }),
      )

      const report = await ProcessRegistry.sweepOrphans({
        dir,
        readStartTime: (pid) => (pid === child.pid ? "spawn-token" : undefined),
      })

      expect(report).toMatchObject({ checked: 1, pidReused: 1, killed: 0 })
      // The unrelated live process must still be alive.
      expect(() => process.kill(child.pid!, 0)).not.toThrow()
      await expect(fsp.stat(file)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      try {
        process.kill(-child.pid!, "SIGKILL")
      } catch {
        // Already gone.
      }
    }
  })

  test("the default start-time probe never throws and is stable when available", async () => {
    const first = await ProcessRegistry.readProcessStartTime(process.pid)
    const second = await ProcessRegistry.readProcessStartTime(process.pid)
    expect(second).toBe(first)
    // /proc is always readable on Linux; elsewhere (macOS `ps`) the sandbox
    // may deny the subprocess, in which case the probe degrades to undefined.
    if (process.platform === "linux") expect(first).toBeTruthy()
  })
})
