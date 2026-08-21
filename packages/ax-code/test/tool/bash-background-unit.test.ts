import { afterEach, describe, expect, test } from "vitest"
import { EventEmitter } from "events"
import type { ChildProcess } from "child_process"
import { BackgroundShell } from "../../src/tool/bash-background"

afterEach(async () => {
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
})
