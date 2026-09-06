import { describe, expect, test, vi } from "vitest"
import { claimAxCodeForegroundTtyJob, type TtyJobFfi } from "../../src/util/tty-job"

function fakeFfi(overrides: Partial<TtyJobFfi> & { pid?: number; previous?: number } = {}): TtyJobFfi & {
  calls: { setpgid: number[][]; tcsetpgrp: number[][] }
} {
  const pid = overrides.pid ?? 4242
  const previous = overrides.previous ?? 100
  const calls = { setpgid: [] as number[][], tcsetpgrp: [] as number[][] }
  return {
    calls,
    getpid: overrides.getpid ?? (() => pid),
    tcgetpgrp: overrides.tcgetpgrp ?? (() => previous),
    setpgid:
      overrides.setpgid ??
      ((a, b) => {
        calls.setpgid.push([a, b])
        return 0
      }),
    tcsetpgrp:
      overrides.tcsetpgrp ??
      ((fd, pgid) => {
        calls.tcsetpgrp.push([fd, pgid])
        return 0
      }),
  }
}

describe("claimAxCodeForegroundTtyJob", () => {
  test("skips Windows and non-TTY stdio", () => {
    const ffi = fakeFfi()
    expect(claimAxCodeForegroundTtyJob({ platform: "win32", stdinIsTty: true, stdoutIsTty: true, ffi })).toBe(false)
    expect(claimAxCodeForegroundTtyJob({ platform: "darwin", stdinIsTty: false, stdoutIsTty: false, ffi })).toBe(false)
    expect(ffi.calls.setpgid).toEqual([])
  })

  test("is a no-op when this process already owns the TTY", () => {
    const ffi = fakeFfi({ pid: 9, previous: 9 })
    expect(claimAxCodeForegroundTtyJob({ platform: "darwin", stdinIsTty: true, stdoutIsTty: true, ffi })).toBe(true)
    expect(ffi.calls.setpgid).toEqual([])
    expect(ffi.calls.tcsetpgrp).toEqual([])
  })

  test("creates a new process group and makes it the TTY foreground job", () => {
    const ffi = fakeFfi({ pid: 4242, previous: 100 })
    expect(claimAxCodeForegroundTtyJob({ platform: "darwin", stdinIsTty: true, stdoutIsTty: true, ffi })).toBe(true)
    expect(ffi.calls.setpgid).toEqual([[0, 0]])
    expect(ffi.calls.tcsetpgrp).toEqual([[0, 4242]])
  })

  test("restores the previous process group when tcsetpgrp fails", () => {
    const ffi = fakeFfi({
      pid: 7,
      previous: 3,
      tcsetpgrp: () => -1,
    })
    const setpgid = vi.fn((pid: number, pgid: number) => 0)
    ffi.setpgid = setpgid
    expect(claimAxCodeForegroundTtyJob({ platform: "linux", stdinIsTty: false, stdoutIsTty: true, ffi })).toBe(false)
    expect(setpgid).toHaveBeenCalledWith(0, 0)
    expect(setpgid).toHaveBeenCalledWith(0, 3)
  })

  test("does nothing without FFI", () => {
    expect(claimAxCodeForegroundTtyJob({ platform: "darwin", stdinIsTty: true, stdoutIsTty: true, ffi: null })).toBe(
      false,
    )
  })
})
