import { describe, expect, test, vi } from "vitest"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { classifyReadOnlyCommand, planReadOnlyError, readonlyRedirectDenial } from "../../src/tool/bash-readonly"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async (_req?: PermissionRequest) => {},
}

const planCtx = { ...ctx, agent: "plan" }

describe("classifyReadOnlyCommand", () => {
  test("accepts known read commands", () => {
    const allowed: string[][] = [
      ["ls", "-la"],
      ["cat", "README.md"],
      ["head", "-n", "5", "file.txt"],
      ["tail", "-n", "3", "file.txt"],
      ["wc", "-l", "file.txt"],
      ["grep", "-rn", "pattern", "."],
      ["rg", "-i", "pattern", "src"],
      ["find", ".", "-name", "*.ts"],
      ["pwd"],
      ["which", "node"],
      ["stat", "package.json"],
      ["file", "dist/index.js"],
      ["tree", "-L", "2"],
      ["sort", "file.txt"],
      ["uniq", "-c", "file.txt"],
      ["cut", "-d", ":", "-f1", "file.txt"],
      ["echo", "hello world"],
      ["/bin/ls"],
    ]
    for (const parts of allowed) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toBeUndefined()
    }
  })

  test("accepts read-only git subcommands and wrapper-wrapped reads", () => {
    const allowed: string[][] = [
      ["git", "status"],
      ["git", "log", "--oneline", "-5"],
      ["git", "diff", "HEAD~1"],
      ["git", "show", "HEAD:file.ts"],
      ["git", "branch"],
      ["git", "branch", "--list"],
      ["git", "rev-parse", "HEAD"],
      ["git", "ls-files"],
      ["git", "-C", "sub", "status"],
      ["env", "GIT_PAGER=cat", "git", "log"],
      ["env", "-u", "PAGER", "git", "diff"],
      ["sudo", "cat", "/etc/hosts"],
      ["xargs", "cat"],
      ["FOO=1", "ls"],
    ]
    for (const parts of allowed) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toBeUndefined()
    }
  })

  test("denies write commands with specific reasons", () => {
    const cases: Array<[string[], RegExp]> = [
      [["sed", "-i", "", "s/a/b/", "file.txt"], /sed -i/],
      [["tee", "out.txt"], /tee/],
      [["find", ".", "-delete"], /find/],
      [["find", ".", "-name", "x", "-exec", "rm", "{}", ";"], /find/],
      [["find", ".", "-fprint", "list.txt"], /find/],
      [["git", "commit", "-m", "message"], /git commit/],
      [["git", "push", "origin", "main"], /git push/],
      [["git", "checkout", "-b", "feature"], /git checkout/],
      [["git", "branch", "feature-x"], /git branch/],
      [["git", "branch", "-D", "stale"], /git branch/],
      [["curl", "-o", "body.json", "https://example.com"], /curl -o/],
      [["dd", "if=input", "of=output"], /dd/],
      [["rm", "file.txt"], /rm/],
      [["mv", "a", "b"], /mv/],
    ]
    for (const [parts, pattern] of cases) {
      const reason = classifyReadOnlyCommand(parts)
      expect(reason, parts.join(" ")).toBeDefined()
      expect(reason).toMatch(pattern)
    }
  })

  test("fails closed for unclassified commands", () => {
    const cases: string[][] = [
      ["npm", "install"],
      ["pnpm", "test"],
      ["node", "-e", "code"],
      ["python3", "-c", "code"],
      ["bash", "script.sh"],
      ["sh", "-c", "anything"],
      ["cd", "subdirectory"],
      ["test", "-f", "x"],
      ["make", "build"],
    ]
    for (const parts of cases) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toMatch(/is not in the plan agent's read-only command/)
    }
    expect(classifyReadOnlyCommand([])).toMatch(/could not be classified/)
  })

  test("denies destructive commands with their classification", () => {
    expect(classifyReadOnlyCommand(["rm", "-rf", "/tmp/whatever"])).toMatch(/recursive\+force/)
  })
})

describe("readonlyRedirectDenial", () => {
  test("allows only /dev/null", () => {
    expect(readonlyRedirectDenial("/dev/null")).toBeUndefined()
    expect(readonlyRedirectDenial("out.txt")).toMatch(/out\.txt/)
    expect(readonlyRedirectDenial(undefined)).toMatch(/non-literal/)
  })
})

describe("planReadOnlyError", () => {
  test("uses the ADR-208 wording", () => {
    expect(planReadOnlyError(["sed -i edits files in place"])).toBe(
      "The plan agent's bash is read-only: sed -i edits files in place. Hand this command to the build agent.",
    )
    expect(planReadOnlyError(["a", "b"])).toBe(
      "The plan agent's bash is read-only: a (and 1 more violation). Hand this command to the build agent.",
    )
  })
})

describe("bash tool plan-agent enforcement (ADR-208)", () => {
  test("runs allowed read commands for the plan agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { model: "test/model", username: "testuser" },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        for (const command of [
          "echo hello",
          "echo hello > /dev/null",
          "ls",
          "echo sample | grep sample",
          "env GIT_PAGER=cat git status",
          'bash -c "ls"',
        ]) {
          const result = await bash.execute({ command, description: "Plan read command" }, planCtx)
          expect(result.metadata.exit, command).toBe(0)
        }
      },
    })
  })

  test("denies write commands for the plan agent before any permission prompt", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { model: "test/model", username: "testuser" },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const cases: Array<[string, RegExp]> = [
          ["echo hi > out.txt", /out\.txt/],
          ["echo hi >> log.txt", /log\.txt/],
          ["ls > listing.txt 2>&1", /listing\.txt/],
          ["sed -i '' 's/a/b/' file.txt", /sed -i/],
          ["echo x | tee out.txt", /tee/],
          ["git commit -m message", /git commit/],
          ["git push", /git push/],
          ["find . -name '*.ts' -delete", /find/],
          ["node -e '1'", /read-only command allowlist/],
          ["ls && git push", /git push/],
          ["(git commit -m x)", /git commit/],
          ['echo "$(git push)"', /git push/],
          ['bash -c "git push"', /git push/],
          ['bash -c "$(cat cmd.txt)"', /cannot inspect/],
          ["bash run.sh", /cannot inspect/],
          ["source run.sh", /cannot inspect/],
          ["cd sub && ls", /read-only command allowlist/],
        ]
        for (const [command, pattern] of cases) {
          const ask = vi.fn()
          const error = (await bash
            .execute({ command, description: "Denied write command" }, { ...planCtx, ask })
            .catch((err) => err)) as Error
          expect(error, command).toBeInstanceOf(Error)
          expect(error.message, command).toMatch(/The plan agent's bash is read-only/)
          expect(error.message, command).toMatch(pattern)
          // The denial fires before any permission prompt.
          expect(ask, command).not.toHaveBeenCalled()
        }
      },
    })
  })

  test("leaves the build agent unaffected", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { model: "test/model", username: "testuser" },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo hi > out.txt && sed -i '' 's/a/b/' out.txt", description: "Build agent write" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })
})
