import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import {
  classifyReadOnlyCommand,
  explicitBashAllowOverride,
  planReadOnlyError,
  readonlyRedirectDenial,
} from "../../src/tool/bash-readonly"
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
      ["uniq", "-f", "2", "file.txt"],
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

  test("denies a time wrapper whose output flag writes a file", () => {
    const denied: string[][] = [
      ["command", "time", "-o", "/tmp/x", "ls"],
      ["env", "time", "-o", "/tmp/x", "ls"],
      ["time", "--output", "/tmp/x", "cat", "f"],
      ["time", "--output=/tmp/x", "ls"],
      ["command", "time", "-po", "/tmp/x", "ls"],
    ]
    for (const parts of denied) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toContain("time")
    }
  })

  test("allows a time wrapper without an output flag", () => {
    expect(classifyReadOnlyCommand(["command", "time", "-p", "ls"])).toBeUndefined()
    // A value-taking flag's argument is never mistaken for the output flag.
    expect(classifyReadOnlyCommand(["time", "-f", "-o", "ls"])).toBeUndefined()
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
      [["git", "show", "--output=leak.diff", "HEAD"], /git show/],
      [["git", "diff", "--output", "leak.diff", "HEAD"], /git diff/],
      [["git", "log", "-p", "--output=leak.diff"], /git log/],
      [["curl", "-o", "body.json", "https://example.com"], /curl -o/],
      [["dd", "if=input", "of=output"], /dd/],
      [["rm", "file.txt"], /rm/],
      [["mv", "a", "b"], /mv/],
      [["sort", "-o", "out.txt", "file.txt"], /sort/],
      [["sort", "--output=out.txt", "file.txt"], /sort/],
      [["sort", "--compress-program=evil", "file.txt"], /sort/],
      [["sort", "-T", "/tmp", "file.txt"], /sort/],
      [["uniq", "in.txt", "out.txt"], /uniq/],
      [["tree", "-o", "out.txt"], /tree/],
      [["rg", "--pre=evil", "pattern"], /rg --pre/],
      [["file", "-C", "-m", "magic"], /file -C/],
      [["file", "-bC", "magic"], /file -C/],
    ]
    for (const [parts, pattern] of cases) {
      const reason = classifyReadOnlyCommand(parts)
      expect(reason, parts.join(" ")).toBeDefined()
      expect(reason).toMatch(pattern)
    }
  })

  test("denies abbreviated writing flags and auxiliary command execution", () => {
    for (const parts of [
      ["sort", "--out=result", "input"],
      ["sort", "--out", "result", "input"],
      ["sort", "--temporary=/tmp"],
      ["sort", "--compress=helper"],
      ["file", "--comp", "-m", "magic"],
      ["rg", "--hostname-bin=helper", "--hyperlink-format=default", "pattern"],
      ["rg", "--hostname-bin", "helper", "pattern"],
      ["GIT_TRACE=/tmp/trace", "git", "status"],
      ["env", "GIT_TRACE2_EVENT=/tmp/events", "git", "log"],
    ]) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toBeDefined()
    }
    for (const parts of [
      ["sort", "--check", "input"],
      ["file", "--mime-type", "input"],
      ["rg", "--hyperlink-format=default", "pattern"],
    ]) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toBeUndefined()
    }
  })

  test("denies git config and env overrides that can run an external command", () => {
    const denied: string[][] = [
      ["git", "-c", "diff.external=sh -c 'touch pwned'", "diff", "--no-index", "a", "b"],
      ["git", "-C", "sub", "-c", "diff.external=sh", "diff", "a", "b"],
      ["git", "--config-env=diff.external=GIT_EXT", "diff", "a", "b"],
      ["git", "diff", "--ext-diff", "a", "b"],
      ["git", "log", "--textconv", "-p"],
      ["git", "show", "--paginate", "HEAD"],
      ["GIT_EXTERNAL_DIFF=sh", "git", "diff", "a", "b"],
      ["GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=diff.external", "GIT_CONFIG_VALUE_0=sh", "git", "diff", "a", "b"],
    ]
    for (const parts of denied) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toMatch(/external|override/)
    }
    const allowed: string[][] = [
      ["git", "-C", "sub", "status"],
      ["env", "GIT_PAGER=cat", "git", "log"],
      ["git", "diff", "-c"],
      ["git", "log", "--no-ext-diff", "-p"],
    ]
    for (const parts of allowed) {
      expect(classifyReadOnlyCommand(parts), parts.join(" ")).toBeUndefined()
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

describe("explicitBashAllowOverride (ADR-224)", () => {
  const rule = (pattern: string, action: Permission.Action, permission = "bash") => ({ permission, pattern, action })

  test("returns the pattern when an explicit allow rule names the command", () => {
    expect(explicitBashAllowOverride("npm test", [rule("npm *", "allow")])).toBe("npm *")
    expect(explicitBashAllowOverride("node --version", [rule("node --version", "allow")])).toBe("node --version")
    expect(explicitBashAllowOverride("git commit -m x", [rule("git commit *", "allow")])).toBe("git commit *")
  })

  test("a bare wildcard allow does not count", () => {
    expect(explicitBashAllowOverride("npm test", [rule("*", "allow")])).toBeUndefined()
    expect(explicitBashAllowOverride("npm test", [rule("* *", "allow")])).toBeUndefined()
  })

  test("a pattern naming a different command does not count", () => {
    expect(explicitBashAllowOverride("npm test", [rule("git *", "allow")])).toBeUndefined()
    expect(explicitBashAllowOverride("npm test", [rule("* test", "allow")])).toBeUndefined()
  })

  test("an ask rule does not override the classifier", () => {
    expect(explicitBashAllowOverride("npm test", [rule("npm *", "ask")])).toBeUndefined()
  })

  test("a later matching deny wins over an earlier allow (managed precedence)", () => {
    expect(explicitBashAllowOverride("npm test", [rule("npm *", "allow"), rule("npm *", "deny")])).toBeUndefined()
    expect(explicitBashAllowOverride("npm test", [rule("npm *", "allow"), rule("*", "deny")])).toBeUndefined()
  })

  test("no matching rule does not override", () => {
    expect(explicitBashAllowOverride("npm test", [])).toBeUndefined()
    expect(explicitBashAllowOverride("npm test", [rule("ls", "allow")])).toBeUndefined()
  })
})

describe("plan-agent explicit allow override (ADR-224)", () => {
  const managedConfigDir = process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR!

  test("an explicit user allow rule unlocks only the named command", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          model: "test/model",
          username: "testuser",
          permission: { bash: { "node --version": "allow" } },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute({ command: "node --version", description: "Allowed override" }, planCtx)
          expect(result.metadata.exit).toBe(0)
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("a bare wildcard allow does not unlock the classifier", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          model: "test/model",
          username: "testuser",
          permission: { bash: "allow" },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const error = (await bash
            .execute({ command: "node --version", description: "Wildcard allow" }, planCtx)
            .catch((err) => err)) as Error
          expect(error).toBeInstanceOf(Error)
          expect(error.message).toMatch(/The plan agent's bash is read-only/)
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("a compound command overrides only the matching segment", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          model: "test/model",
          username: "testuser",
          permission: { bash: { "node --version": "allow" } },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const error = (await bash
            .execute(
              { command: "node --version && rm definitely-missing.txt", description: "Compound override" },
              planCtx,
            )
            .catch((err) => err)) as Error
          expect(error).toBeInstanceOf(Error)
          expect(error.message).toMatch(/The plan agent's bash is read-only/)
          expect(error.message).toMatch(/rm/)
          expect(error.message).not.toMatch(/node --version/)
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("a managed deny wins over the user allow override", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await fs.mkdir(managedConfigDir, { recursive: true })
    await fs.writeFile(
      path.join(managedConfigDir, "ax-code.json"),
      JSON.stringify({ permission: { bash: { "node --version": "deny" } } }),
    )
    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          model: "test/model",
          username: "testuser",
          permission: { bash: { "node --version": "allow" } },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const error = (await bash
            .execute({ command: "node --version", description: "Managed deny" }, planCtx)
            .catch((err) => err)) as Error
          expect(error).toBeInstanceOf(Error)
          expect(error.message).toMatch(/The plan agent's bash is read-only/)
        },
      })
    } finally {
      vi.unstubAllEnvs()
      await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
    }
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
          { command: "echo hi > out.txt && sed -i.bak 's/hi/bye/' out.txt", description: "Build agent write" },
          ctx,
        )
        expect(result.metadata.exit, result.output).toBe(0)
        expect(await fs.readFile(path.join(tmp.path, "out.txt"), "utf8")).toBe("bye\n")
      },
    })
  })
})
