import { execFileSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Global } from "../../src/global"
import * as Bootstrap from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import * as Git from "../../src/util/git"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

/**
 * ADR-231: when `task_parallel.worktree_isolation` is on, every writer
 * child runs in its own Worktree worktree, and the post-pool pass
 * computes `git diff --stat <base>..HEAD` and
 * `git status --porcelain=v1 --untracked-files=all` to
 * decide whether to keep or remove the worktree. These tests lock the
 * building blocks the executor relies on (worktree create/remove, diff
 * stat, status porcelain) using real git so a missing or misnamed flag
 * is caught here instead of in production dogfood. The
 * `writer worktree cleanup` block below drives the real executor with
 * `SessionPrompt.prompt` mocked (same pattern as task_parallel.test.ts)
 * to lock the keep/remove decision itself.
 *
 * NOTE on `Worktree.create` vs `createReady`: the sandbox cannot run
 * the start-scripts bootstrap that `createReady` depends on
 * (test/worktree/worktree.test.ts:140 hits the same `Worktree failed
 * to become ready` error). `Worktree.create` returns the same `info`
 * shape (name, branch, directory) without the start-scripts gate, so
 * the post-pool diff/status logic the executor depends on is exercised
 * end-to-end. A future commit that fixes the bootstrap can swap
 * `create` for `createReady` here without changing assertions.
 */
describe("task_parallel worktree isolation primitives (ADR-231)", () => {
  test("Worktree.create gives the child a separate directory, branch, and recorded name", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-0-isolated" })

        try {
          expect(worktree.name).toBe("swarm-0-isolated")
          expect(worktree.branch).toBe("ax-code/swarm-0-isolated")
          // The worktree directory must live under the project's per-worktree
          // root, not inside the primary tree — otherwise a writer would
          // stomp on the main checkout.
          const projectRoot = path.join(Global.Path.data, "worktree", Instance.project.id)
          expect(path.dirname(worktree.directory)).toBe(projectRoot)
          expect(worktree.directory.startsWith(tmp.path)).toBe(false)

          // The worktree is rooted at the project's HEAD, so a
          // post-pool `git diff --stat <base>..HEAD` reports no
          // changes when the child has not yet edited anything.
          const emptyStat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          expect(emptyStat).toBe("")

          // The child branch is the worktree's HEAD.
          const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          expect(branch).toBe(worktree.branch)
        } finally {
          // Cleanup so the per-project worktree root stays empty between
          // test runs.
          await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
        }
      },
    })
  })

  test("a dirty worktree (uncommitted changes only) keeps the worktree and surfaces a stat fallback", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-1-dirty" })

        try {
          // The post-pool decision in src/tool/task_parallel.ts reads
          // `git diff --stat <base>..HEAD` and `git status --porcelain`.
          // Write a new file in the worktree so the status side reports
          // a dirty tree (no commits yet, so the diff stat stays empty).
          await fs.writeFile(path.join(worktree.directory, "wip.txt"), "wip\n")

          const stat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          // The executor's `dirty = status.length > 0` predicate is the
          // branch that flips "no diff" into "kept worktree with
          // uncommitted changes". Lock the predicate here so a future
          // refactor of either command's flags is caught.
          expect(stat).toBe("")
          expect(status.length).toBeGreaterThan(0)
          expect(status.includes("wip.txt")).toBe(true)
        } finally {
          await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
        }
      },
    })
  })

  test("a worktree with a committed change keeps the worktree and the diff stat is non-empty", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-2-commit" })

        try {
          await fs.writeFile(path.join(worktree.directory, "new.txt"), "hello\n")
          // The post-pool snapshot in arena-implement.ts commits the
          // writer's work inside the worktree so the diff stat has a
          // stable base. We do the same here to mirror the real
          // executor's working tree state at the moment it reads the
          // diff.
          execFileSync("git", ["add", "--all"], { cwd: worktree.directory })
          execFileSync(
            "git",
            ["-c", "user.name=AX Code Test", "-c", "user.email=test@ax-code.local", "commit", "-m", "wip"],
            { cwd: worktree.directory, stdio: "pipe" },
          )

          const stat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
            cwd: worktree.directory,
            encoding: "utf8",
          }).trim()
          expect(stat.length).toBeGreaterThan(0)
          expect(stat).toContain("new.txt")
        } finally {
          await Worktree.remove({ directory: worktree.directory }).catch(() => undefined)
        }
      },
    })
  })

  test("Worktree.remove on a worktree with no commits and a clean tree removes both branch and directory", async () => {
    // This is the "zero commits and a clean tree → remove" branch from
    // ADR-231 D3. End-to-end via Worktree.create + Worktree.remove so
    // we know the same calls the executor makes actually clean up.
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester" },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const base = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()

        const worktree = await Worktree.create({ name: "swarm-3-clean" })

        // No edits: diff and status are both empty.
        const stat = execFileSync("git", ["diff", "--stat", base, "HEAD", "--"], {
          cwd: worktree.directory,
          encoding: "utf8",
        }).trim()
        const status = execFileSync("git", ["status", "--porcelain=v1"], {
          cwd: worktree.directory,
          encoding: "utf8",
        }).trim()
        expect(stat).toBe("")
        expect(status).toBe("")

        // Remove and verify the directory and branch are both gone.
        await Worktree.remove({ directory: worktree.directory })

        await expect(fs.stat(worktree.directory)).rejects.toThrow()
        const branches = execFileSync("git", ["branch", "--list", worktree.branch], {
          cwd: tmp.path,
          encoding: "utf8",
        }).trim()
        expect(branches).toBe("")
      },
    })
  })
})

/**
 * Parent-session scaffolding, same shape as the `parent()` helper in
 * test/tool/task_parallel.test.ts: a real session + assistant message so
 * TaskParallelTool.execute can resolve its constraints.
 */
async function parentForExecutor(tmpPath: string) {
  const parentSession = await Session.create({})
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: parentSession.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test" as any, modelID: "test-model" as any },
    tools: {},
    isolation: { mode: "read-only", network: false },
    mode: "build",
  } as any)
  const assistant = await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID: parentSession.id,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: tmpPath, root: tmpPath },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "test-model",
    providerID: "test",
    time: { created: Date.now() },
  } as MessageV2.Assistant)
  const ctx = {
    sessionID: parentSession.id,
    messageID: assistant.id,
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
    extra: {},
  } as any
  return { ctx }
}

/** Mocked member result shape consumed by runMemberInsideInstance. */
function memberPromptResult(input: any, ok: boolean) {
  return {
    info: {
      id: input.messageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: Date.now(), completed: Date.now() },
      ...(ok ? {} : { error: { name: "TestFailure", data: { message: "member failed" } } }),
    },
    parts: [{ type: "text", text: "done" }],
  } as any
}

const TWO_WRITER_TASKS = [
  { description: "write a", prompt: "write a", subagent_type: "build" },
  { description: "write b", prompt: "write b", subagent_type: "build" },
]

/**
 * The full InstanceBootstrap (plugin/LSP/etc. init) cannot run against a
 * freshly created worktree inside this sandbox — the same environmental
 * limitation that fails test/worktree/worktree.test.ts' `createReady`
 * cases here ("Worktree failed to become ready"). Stubbing it to a no-op
 * lets the REAL Worktree.createReady, the member's Instance.provide, and
 * the finalization's git reads all run for real, which is exactly the
 * behaviour under test. Same module-namespace spy pattern as Git.git in
 * test/snapshot/*.
 */
function stubInstanceBootstrap() {
  vi.spyOn(Bootstrap, "InstanceBootstrap").mockImplementation(async () => undefined)
}

describe("task_parallel writer worktree cleanup (ADR-231 §3)", () => {
  test("a writer's untracked files are kept even when status.showUntrackedFiles=no hides them", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", agents: { task_parallel: { worktree_isolation: true } } },
    })
    // Repo-local config is shared by every worktree of this repository, so a
    // bare `git status --porcelain` in the writer worktree reports nothing
    // while the writer's new files are still on disk. The keep/remove
    // decision must not lose them.
    execFileSync("git", ["config", "status.showUntrackedFiles", "no"], { cwd: tmp.path, stdio: "pipe" })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parentForExecutor(tmp.path)
        stubInstanceBootstrap()
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          // The member runs inside its worktree via Instance.provide, so
          // Instance.directory is the worktree the finalizer will judge.
          await fs.writeFile(path.join(Instance.directory, "untracked.txt"), "precious\n")
          return memberPromptResult(input, true)
        }) as any)
        try {
          const result = await (await TaskParallelTool.init()).execute({ tasks: TWO_WRITER_TASKS } as any, ctx)
          const metadata = result.metadata as any
          expect(metadata.worktreesKept).toBe(2)
          expect(metadata.worktreesRemoved).toBe(0)
          for (const entry of metadata.results) {
            expect(entry.worktree.kept).toBe(true)
            expect(await fs.readFile(path.join(entry.worktree.directory, "untracked.txt"), "utf8")).toBe("precious\n")
          }
          for (const entry of metadata.results) {
            await Worktree.remove({ directory: entry.worktree.directory }).catch(() => undefined)
          }
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })

  test("a finalization git failure keeps the worktree instead of deleting it", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", agents: { task_parallel: { worktree_isolation: true } } },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parentForExecutor(tmp.path)
        stubInstanceBootstrap()
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) =>
          memberPromptResult(input, true)) as any)
        const runGit = Git.git
        vi.spyOn(Git, "git").mockImplementation(async (args: string[], options: any) => {
          // Fail exactly the two reads finalizeWriterWorktree performs; every
          // other git call (worktree creation, rev-parse, removal) passes
          // through so the swarm itself still runs.
          if (args[0] === "status" || (args[0] === "diff" && args[1] === "--stat")) {
            return {
              exitCode: 128,
              text: () => "",
              stdout: Buffer.alloc(0),
              stderr: Buffer.from("fatal: unable to read repository"),
            }
          }
          return runGit(args, options)
        })
        try {
          const result = await (await TaskParallelTool.init()).execute({ tasks: TWO_WRITER_TASKS } as any, ctx)
          const metadata = result.metadata as any
          // A tree whose change state could not be read must never be
          // force-removed on the assumption it was empty.
          expect(metadata.worktreesKept).toBe(2)
          expect(metadata.worktreesRemoved).toBe(0)
          for (const entry of metadata.results) {
            expect(entry.worktree.kept).toBe(true)
            await fs.stat(entry.worktree.directory)
          }
          for (const entry of metadata.results) {
            await Worktree.remove({ directory: entry.worktree.directory }).catch(() => undefined)
          }
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })

  test("a failed writer's clean worktree is removed when its child finishes", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { username: "tester", agents: { task_parallel: { worktree_isolation: true } } },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { ctx } = await parentForExecutor(tmp.path)
        stubInstanceBootstrap()
        vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) =>
          memberPromptResult(input, false)) as any)
        try {
          const result = await (await TaskParallelTool.init()).execute({ tasks: TWO_WRITER_TASKS } as any, ctx)
          const metadata = result.metadata as any
          // ADR-231 §3 keys removal on "zero commits and a clean tree", not
          // on the member outcome: a failed member's empty worktree produced
          // no patch either, so it must not leak.
          expect(metadata.worktreesRemoved).toBe(2)
          expect(metadata.worktreesKept).toBe(0)
          for (const entry of metadata.results) {
            expect(entry.ok).toBe(false)
            expect(entry.worktree.removed).toBe(true)
            await expect(fs.stat(entry.worktree.directory)).rejects.toThrow()
          }
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })
})
