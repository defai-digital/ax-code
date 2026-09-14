import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import { EventEmitter } from "events"
import type { ChildProcess } from "child_process"
import { BackgroundShell } from "../../src/tool/bash-background"

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const shell of BackgroundShell.list()) {
    await BackgroundShell.kill(shell.id)
  }
  BackgroundShell.resetForTests()
})

// Process-free BackgroundShell registry coverage: fakeProc() is an
// EventEmitter, so no child process is ever spawned. pid stays undefined so
// afterEach's kill() cannot signal a real process.
describe("BackgroundShell registry", () => {
  function fakeProc(): ChildProcess {
    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = undefined
    proc.exitCode = null
    return proc as ChildProcess
  }

  test("capacity limit rejects new background shells per session", () => {
    for (let i = 0; i < 16; i++) {
      BackgroundShell.register({ sessionID: "ses_bg_cap", command: "noop", description: "fake", proc: fakeProc() })
    }
    expect(() => BackgroundShell.assertCapacity("ses_bg_cap")).toThrow(/Too many running background shells/)
    expect(() =>
      BackgroundShell.register({ sessionID: "ses_bg_cap", command: "noop", description: "fake", proc: fakeProc() }),
    ).toThrow(/Too many running background shells/)
    expect(() => BackgroundShell.assertCapacity("ses_bg_cap_other")).not.toThrow()
  })

  test("waitAndRead does not hang after consuming initial output", async () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({
      sessionID: "ses_bg_wait_race",
      command: "noop",
      description: "fake",
      proc,
    })
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("first\n"))
    const first = await BackgroundShell.waitAndRead(info.id, "ses_bg_wait_race", { timeoutMs: 50 })
    expect(first?.output).toContain("first")

    const pending = BackgroundShell.waitAndRead(info.id, "ses_bg_wait_race", { timeoutMs: 2_000 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("second\n"))
    const second = await pending
    expect(second?.output).toContain("second")
    expect(second?.output).not.toContain("first")
  })

  test("waitAndRead abort rejects without consuming later output", async () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({
      sessionID: "ses_bg_wait_abort",
      command: "noop",
      description: "fake",
      proc,
    })
    const controller = new AbortController()
    const pending = BackgroundShell.waitAndRead(info.id, "ses_bg_wait_abort", {
      timeoutMs: 5_000,
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("after-abort\n"))
    const later = BackgroundShell.read(info.id, "ses_bg_wait_abort")
    expect(later?.output).toContain("after-abort")
  })

  test("multi-byte UTF-8 characters split across chunks are not corrupted", () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({ sessionID: "ses_bg_utf8", command: "noop", description: "fake", proc })
    const bytes = Buffer.from("héllo", "utf8")
    ;(proc.stdout as unknown as EventEmitter).emit("data", bytes.subarray(0, 2))
    ;(proc.stdout as unknown as EventEmitter).emit("data", bytes.subarray(2))
    const read = BackgroundShell.read(info.id, "ses_bg_utf8")
    expect(read!.output).toBe("héllo")
  })

  test("observer backlog preserves stdout and stderr boundaries", () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({
      sessionID: "ses_bg_observer",
      command: "noop",
      description: "fake",
      proc,
    })
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("stdout-part"))
    ;(proc.stderr as unknown as EventEmitter).emit("data", Buffer.from("stderr-part"))

    const chunks: Array<{ stream: BackgroundShell.OutputStream; text: string }> = []
    const unsubscribe = BackgroundShell.observe(info.id, "ses_bg_observer", {
      onOutput: (stream, text) => chunks.push({ stream, text }),
    })

    expect(chunks).toEqual([
      { stream: "stdout", text: "stdout-part" },
      { stream: "stderr", text: "stderr-part" },
    ])
    unsubscribe?.()
  })

  test("evicts oldest unread finished shells beyond the retention cap", () => {
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const proc = fakeProc()
      const info = BackgroundShell.register({
        sessionID: "ses_bg_evict",
        command: `noop ${i}`,
        description: "fake",
        proc,
      })
      ids.push(info.id)
      ;(proc as unknown as EventEmitter).emit("close")
    }
    const proc = fakeProc()
    BackgroundShell.register({ sessionID: "ses_bg_evict", command: "trigger", description: "fake", proc })
    const remaining = BackgroundShell.list("ses_bg_evict")
    const finished = remaining.filter((s) => s.status !== "running")
    expect(finished.length).toBeLessThanOrEqual(16)
    // The oldest finished shells were evicted, the newest retained.
    expect(remaining.some((s) => s.id === ids[0])).toBe(false)
    expect(remaining.some((s) => s.id === ids[19])).toBe(true)
  })

  test("unread output is capped and marked dropped", () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({ sessionID: "ses_bg_buf", command: "noop", description: "fake", proc })
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("x".repeat(3 * 1024 * 1024)))
    const read = BackgroundShell.read(info.id, "ses_bg_buf")
    expect(read).toBeDefined()
    expect(read!.dropped).toBe(true)
    expect(read!.output.length).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  test("many sessions retain bounded disk, metadata and observer replay", () => {
    const ids: string[] = []
    const payload = Buffer.from("x".repeat(1024 * 1024))
    for (let i = 0; i < 70; i++) {
      const proc = fakeProc()
      const info = BackgroundShell.register({ sessionID: `session_${i}`, command: "noop", description: "fake", proc })
      ids.push(info.id)
      ;(proc.stdout as unknown as EventEmitter).emit("data", payload)
      ;(proc as unknown as EventEmitter).emit("close")
      const stats = BackgroundShell.retentionStatsForTests()
      expect(stats.reservedBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
      expect(stats.observerBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    }
    expect(BackgroundShell.list()).toHaveLength(64)
    expect(BackgroundShell.get(ids[0])).toBeUndefined()
    expect(BackgroundShell.read(ids[6])?.info.outputStatus).toBe("expired")
    const latest = BackgroundShell.read(ids[69])!
    expect(latest.output).toBe(payload.toString())
    expect(latest.info.outputStatus).toBe("complete")
  })

  test("global active admission does not evict running shells", () => {
    for (let i = 0; i < 32; i++) {
      const proc = fakeProc()
      BackgroundShell.register({ sessionID: `active_${i}`, command: "noop", description: "fake", proc })
      ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("active output"))
    }
    expect(() => BackgroundShell.assertCapacity("another")).toThrow(/32 per process/)
    expect(BackgroundShell.list()).toHaveLength(32)
    for (const info of BackgroundShell.list()) {
      expect(info.status).toBe("running")
      expect(info.outputStatus).toBe("complete")
    }
  })

  test("idle timer expires finished output and backlog without touching running ownership", () => {
    vi.useFakeTimers()
    const finishedProc = fakeProc()
    const finished = BackgroundShell.register({
      sessionID: "expired",
      command: "noop",
      description: "fake",
      proc: finishedProc,
    })
    ;(finishedProc.stdout as unknown as EventEmitter).emit("data", Buffer.from("old proof"))
    ;(finishedProc as unknown as EventEmitter).emit("close")
    const activeProc = fakeProc()
    const active = BackgroundShell.register({
      sessionID: "active",
      command: "noop",
      description: "fake",
      proc: activeProc,
    })
    ;(activeProc.stdout as unknown as EventEmitter).emit("data", Buffer.from("live proof"))
    vi.advanceTimersByTime(31 * 60 * 1000)
    const expired = BackgroundShell.read(finished.id, "expired")!
    expect(expired.output).toBe("")
    expect(expired.dropped).toBe(true)
    expect(expired.info.outputStatus).toBe("expired")
    expect(BackgroundShell.get(active.id)?.status).toBe("running")
    expect(BackgroundShell.read(active.id)?.output).toBe("live proof")
  })

  test("observer replay bounds records and Unicode bytes with a single visible notice", () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({ sessionID: "observer_limits", command: "noop", description: "fake", proc })
    for (let i = 0; i < 200; i++) (proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("é"))
    expect(BackgroundShell.retentionStatsForTests().observerRecords).toBe(128)
    const output: string[] = []
    const exits: BackgroundShell.Info[] = []
    const unsubscribe = BackgroundShell.observe(info.id, "observer_limits", {
      onOutput: (_, text) => output.push(text),
      onExit: (value) => exits.push(value),
    })
    expect(output.slice(0, 128).join("")).toBe("é".repeat(128))
    expect(output[128]).toContain("replay truncated or expired")
    ;(proc.stderr as unknown as EventEmitter).emit("data", Buffer.from("live"))
    ;(proc as unknown as EventEmitter).emit("close")
    expect(output.at(-1)).toBe("live")
    expect(exits).toHaveLength(1)
    unsubscribe?.()
    const second = vi.fn()
    BackgroundShell.observe(info.id, "observer_limits", { onOutput: second })
    expect(second).not.toHaveBeenCalled()
    expect(BackgroundShell.read(info.id)?.output).toBe("é".repeat(200) + "live")
  })

  test("cross-session reads and observers do not consume private output; removal cleans disk", async () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({ sessionID: "owner", command: "noop", description: "fake", proc })
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("private proof"))
    ;(proc as unknown as EventEmitter).emit("close")
    const directory = BackgroundShell.retentionStatsForTests().directory!
    expect(BackgroundShell.read(info.id, "other")).toBeUndefined()
    expect(BackgroundShell.observe(info.id, "other", { onOutput: vi.fn() })).toBeUndefined()
    await BackgroundShell.killForSession("other")
    expect(fs.existsSync(directory)).toBe(true)
    await BackgroundShell.killForSession("owner")
    expect(fs.existsSync(directory)).toBe(false)
    expect(BackgroundShell.retentionStatsForTests().observerBytes).toBe(0)
  })

  test("metadata previews are byte bounded and disclose truncation", () => {
    const info = BackgroundShell.register({
      sessionID: "previews",
      command: "é".repeat(20_000),
      description: "🦊".repeat(1000),
      proc: fakeProc(),
    })
    expect(Buffer.byteLength(info.command)).toBeLessThanOrEqual(8192)
    expect(Buffer.byteLength(info.description)).toBeLessThanOrEqual(1024)
    expect(info.command + info.description).not.toContain("�")
    expect(info.metadataTruncated).toBe(true)
  })
})
