import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createGit } from "../src/git"

function result(code = 0, stdout = "", stderr = "") {
  return { code, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("host-bound Git runner", () => {
  test("preserves argv, process options, output buffers and text decoding", async () => {
    const output = result(0, "branch-name\n", "warning\n")
    const run = vi.fn().mockResolvedValue(output)
    const git = createGit({ run })
    const opts = { cwd: "/fixture/repo", env: { GIT_OPTIONAL_LOCKS: "0" }, timeout: 1234 }
    const args = ["show", "HEAD:file with spaces.txt"]
    const actual = await git(args, opts)
    expect(run).toHaveBeenCalledExactlyOnceWith(["git", ...args], {
      ...opts,
      stdin: "ignore",
      nothrow: true,
    })
    expect(actual.exitCode).toBe(0)
    expect(actual.stdout).toBe(output.stdout)
    expect(actual.stderr).toBe(output.stderr)
    expect(actual.text()).toBe("branch-name\n")
    expect(args).toEqual(["show", "HEAD:file with spaces.txt"])
    expect(vi.getTimerCount()).toBe(0)
  })

  test.each([
    "fatal: index.lock exists",
    "fatal: 'refs/heads/main.lock': File exists",
    "fatal: cannot lock ref 'HEAD'",
    "fatal: another git process seems to be running",
    "fatal: Unable to create lock file",
  ])("retries lock acquisition failures: %s", async (stderr) => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result(128, "", stderr))
      .mockResolvedValueOnce(result(0, "ready"))
    const git = createGit({ run })
    const pending = git(["status", "--porcelain"], { cwd: "/fixture/repo" })
    await vi.advanceTimersByTimeAsync(49)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).text()).toBe("ready")
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]).toEqual(run.mock.calls[0])
    expect(vi.getTimerCount()).toBe(0)
  })

  test("stops after five retries with the original linear backoff", async () => {
    const run = vi.fn().mockResolvedValue(result(128, "", "cannot lock ref"))
    const pending = createGit({ run })(["worktree", "add", "fixture"], { cwd: "/fixture/repo" })
    await vi.advanceTimersByTimeAsync(0)
    for (let retry = 1; retry <= 5; retry++) {
      await vi.advanceTimersByTimeAsync(50 * retry - 1)
      expect(run).toHaveBeenCalledTimes(retry)
      await vi.advanceTimersByTimeAsync(1)
      expect(run).toHaveBeenCalledTimes(retry + 1)
    }
    expect((await pending).exitCode).toBe(128)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("stops retrying when the failure becomes permanent", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result(128, "", "index.lock exists"))
      .mockResolvedValue(result(128, "", "not a git repository"))
    const pending = createGit({ run })(["status"], { cwd: "/fixture/repo" })
    await vi.runAllTimersAsync()
    expect((await pending).stderr.toString()).toBe("not a git repository")
    expect(run).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("does not retry successful commands even when stderr mentions a lock", async () => {
    const run = vi.fn().mockResolvedValue(result(0, "ready", "index.lock"))
    expect((await createGit({ run })(["status"], { cwd: "/fixture/repo" })).exitCode).toBe(0)
    expect(run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("returns rejected process errors as a failed Git result", async () => {
    const run = vi.fn().mockRejectedValue(new Error("spawn git ENOENT"))
    const actual = await createGit({ run })(["status"], { cwd: "/fixture/repo" })
    expect(actual.exitCode).toBe(1)
    expect(actual.stdout).toEqual(Buffer.alloc(0))
    expect(actual.text()).toBe("")
    expect(actual.stderr.toString()).toBe("spawn git ENOENT")
    expect(run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("keeps host bindings independent and observes updated host methods", async () => {
    const first = { run: vi.fn().mockResolvedValue(result(0, "first")) }
    const second = { run: vi.fn().mockResolvedValue(result(0, "second")) }
    const git = createGit(first)
    const otherGit = createGit(second)
    first.run = vi.fn().mockResolvedValue(result(0, "updated"))
    expect((await git(["status"], { cwd: "/fixture/first" })).text()).toBe("updated")
    expect((await otherGit(["status"], { cwd: "/fixture/second" })).text()).toBe("second")
  })
})
