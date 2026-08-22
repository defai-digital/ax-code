import { beforeEach, describe, expect, test } from "vitest"
import { runCommand } from "../src/verification-runner"
import { installTestHost, type TestHost } from "./fixture/host"

// Existing timeout behavior of the verification runner (Phase 0 scope: no
// AbortSignal engine API exists yet — only the runCommand timeout path is
// contractual).

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !processAlive(pid)
}

describe("runCommand timeout behavior", () => {
  let testHost: TestHost

  beforeEach(() => {
    testHost = installTestHost({ worktreeRoot: process.cwd(), projectRoot: process.cwd() })
  })

  test("a successful command resolves ok with its exit code", async () => {
    const result = await runCommand("exit 0", process.cwd(), 5000)
    expect(result).toMatchObject({ ok: true, code: 0, timedOut: false })
  })

  test("a failing command resolves not-ok with its exit code, not a throw", async () => {
    const result = await runCommand("exit 3", process.cwd(), 5000)
    expect(result).toMatchObject({ ok: false, code: 3, timedOut: false })
  })

  test("a hanging command times out with code 124 and a timeout marker", async () => {
    const started = Date.now()
    const result = await runCommand("exec sleep 30", process.cwd(), 200)
    const elapsed = Date.now() - started
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.code).toBe(124)
    expect(result.stderr).toContain("timed out after 200ms")
    // Bounded well under the sleep duration — the call does not wait for
    // the child to finish naturally.
    expect(elapsed).toBeLessThan(10_000)
  })

  test("timeout escalation kills a SIGTERM-ignoring child via the host killTree port", async () => {
    // `trap "" TERM` survives `exec` (ignored dispositions persist), so the
    // sleep ignores the initial SIGTERM and the 250ms force-kill grace
    // timer must escalate through host.killTree.
    const result = await runCommand(`trap "" TERM; exec sleep 30`, process.cwd(), 200)
    expect(result.timedOut).toBe(true)
    expect(result.code).toBe(124)

    // The host port was consulted for the escalation and the recorded
    // child is actually gone — no leaked process.
    const kill = testHost.killTreeCalls.find((call) => call.pid !== undefined)
    expect(kill).toBeDefined()
    expect(kill!.alreadyExited).toBe(false)
    expect(await waitForExit(kill!.pid!)).toBe(true)
  })
})
