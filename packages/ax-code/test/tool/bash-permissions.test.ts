import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"

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

class StopAfterPermission extends Error {}

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

// The ask hook throws before bash-impl reaches spawn(), so every test here
// is process-free: permissions are always requested ahead of execution.
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
        await fs.writeFile(path.join(dir, "outside.txt"), "x")
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
                // Bash consumes bare Windows backslashes as escapes. Exercise
                // the actual external path on Windows as well as POSIX hosts.
                command: `cat '${filepath.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`,
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

  test.each([
    ["tee after --", (file: string) => `tee -- '${file}'`],
    ["glued curl -o", (file: string) => `curl -o'${file}' https://example.invalid/x`],
    ["glued wget -O", (file: string) => `wget -O'${file}' https://example.invalid/x`],
    ["bundled wget -qO with glued path", (file: string) => `wget -qO'${file}' https://example.invalid/x`],
    ["bundled wget -qO with separate path", (file: string) => `wget -qO '${file}' https://example.invalid/x`],
    ["bundled curl -sLo", (file: string) => `curl -sLo '${file}' https://example.invalid/x`],
    ["wget default basename under -P", (_file: string, dir: string) => `wget -q -P '${dir}' https://example.invalid/x`],
    [
      "wget --directory-prefix",
      (_file: string, dir: string) => `wget --directory-prefix='${dir}' https://example.invalid/x`,
    ],
    ["wget bundled -qP with glued dir", (_file: string, dir: string) => `wget -qP'${dir}' https://example.invalid/x`],
    ["wget --output-file log", (file: string) => `wget --output-file='${file}' https://example.invalid/x`],
    ["wget bundled -qa append log", (file: string) => `wget -qa '${file}' https://example.invalid/x`],
    [
      "wget bundled -qP with separate dir",
      (_file: string, dir: string) => `wget -qP '${dir}' https://example.invalid/x`,
    ],
    [
      "curl -o relative under --output-dir",
      (_file: string, dir: string) => `curl -o x.bin --output-dir '${dir}' https://example.invalid/x`,
    ],
    ["path-qualified bash -c", (file: string) => `/bin/bash -c "cat '${file}'"`],
    ["glued git -C", (_file: string, dir: string) => `git -C'${dir}' config user.email nobody@example.invalid`],
  ])("asks for external_directory permission for %s", async (_label, build) => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const posix = (value: string) => value.replaceAll("\\", "/").replaceAll("'", "'\\''")
        const command = build(posix(path.join(outerTmp.path, "outside.txt")), posix(outerTmp.path))
        const requests = await collectPermissionRequests(
          (testCtx) => bash.execute({ command, description: "External path" }, testCtx),
          (req) => req.permission === "external_directory",
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq, command).toBeDefined()
        // A resolvable path is asked by directory; git config relocation fails
        // closed with the whole command as the pattern. Either is an ask.
        expect(extDirReq!.patterns.some((pattern) => pattern.startsWith(outerTmp.path) || pattern === command)).toBe(
          true,
        )
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()

        await fs.writeFile(path.join(tmp.path, "tmpfile"), "x")

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
