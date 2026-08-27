/**
 * Sandbox-denial escalation ladder (PRD phase-2 R3).
 *
 * The OS sandbox wrap is faked by spying on OsSandbox.wrapCommand: the fake
 * "wrapped" run is a node one-liner that emits a denial signature (or plain
 * failure text) on stderr and exits non-zero, so tests stay deterministic and
 * offline on every platform. On the escalated retry the wrap is relaxed, so
 * the real command runs through the normal shell spawn.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Isolation } from "../../src/isolation"
import { OsSandbox } from "../../src/isolation/os-sandbox"
import { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import { detectSandboxDenial } from "../../src/tool/bash-sandbox-escalation"

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

const ctx = {
  sessionID: SessionID.make("ses_sandbox_escalation"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async (_req?: PermissionRequest) => {},
}

const DENIAL_LINE = "touch: /System/Library/x: Operation not permitted"

// A fake active wrap whose "sandboxed" run fails with the given stderr text,
// ignoring the actual command — stands in for a sandboxed command denied by
// the kernel sandbox.
function fakeFailingWrap(stderrLine: string): OsSandbox.WrapResult {
  return {
    active: true,
    mechanism: "seatbelt",
    file: process.execPath,
    args: ["-e", `console.error(${JSON.stringify(stderrLine)}); process.exit(1)`],
    shell: false,
  }
}

const seatbeltWrap: OsSandbox.WrapResult = {
  active: true,
  mechanism: "seatbelt",
  file: "sandbox-exec",
  args: [],
  shell: false,
}
const inactiveWrap: OsSandbox.WrapResult = { active: false, reason: "unavailable in test" }
const workspaceWrite: Isolation.State = { mode: "workspace-write", network: false, protected: [], backend: "auto" }

// See os-sandbox.test.ts — inherited AX_CODE_ISOLATION_* from a parent
// ax-code session would skew mode/backend resolution.
const clearIsolationEnv = () => {
  delete process.env.AX_CODE_ISOLATION_MODE
  delete process.env.AX_CODE_ISOLATION_NETWORK
  delete process.env.AX_CODE_ISOLATION_BACKEND
}

beforeEach(clearIsolationEnv)
afterEach(clearIsolationEnv)

afterEach(() => {
  vi.restoreAllMocks()
})

describe("detectSandboxDenial", () => {
  const base = { wrap: seatbeltWrap, isolation: workspaceWrite, exit: 1, timedOut: false, aborted: false }

  test("matches sandbox denial signatures", () => {
    // EPERM strerror — what Seatbelt-denied writes/network ops surface as.
    expect(detectSandboxDenial({ ...base, output: DENIAL_LINE })?.evidence).toBe("Operation not permitted")
    // sandbox-exec's own profile/exec failures.
    expect(detectSandboxDenial({ ...base, output: "sandbox-exec: execvp() of 'x' failed" })).toBeDefined()
    // sandboxd-style violation lines.
    expect(detectSandboxDenial({ ...base, output: "deny(1) file-write-data /private/etc" })?.evidence).toBe(
      "deny(1) file-write-data",
    )
    // bubblewrap setup/runtime failures.
    const bwrap = { ...base, wrap: { ...seatbeltWrap, mechanism: "bubblewrap" as const } }
    expect(detectSandboxDenial({ ...bwrap, output: "bwrap: setting up uid map: Permission denied" })?.mechanism).toBe(
      "bubblewrap",
    )
  })

  test("never matches ordinary command failures", () => {
    // EACCES from plain file permissions — explicitly out of scope.
    expect(detectSandboxDenial({ ...base, output: "cat: secret: Permission denied" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "bash: foo: command not found" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "npm ERR! code 1" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "" })).toBeUndefined()
    // POSIX EPERM from process-control / ownership — Seatbelt allows signal,
    // and these fail the same way with the wrap off.
    expect(detectSandboxDenial({ ...base, output: "kill: (1) - Operation not permitted" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "pkill: Operation not permitted" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "killall: Operation not permitted" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "renice: 123: Operation not permitted" })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, output: "chown: file: Operation not permitted" })).toBeUndefined()
  })

  test("still matches a file-write EPERM after an ordinary kill EPERM on another line", () => {
    expect(
      detectSandboxDenial({
        ...base,
        output: `kill: (1) - Operation not permitted\n${DENIAL_LINE}`,
      })?.evidence,
    ).toBe("Operation not permitted")
  })

  test("requires an active wrap, a real non-zero exit, and no timeout/abort", () => {
    expect(detectSandboxDenial({ ...base, wrap: inactiveWrap, output: DENIAL_LINE })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, wrap: undefined, output: DENIAL_LINE })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, exit: 0, output: DENIAL_LINE })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, exit: null, output: DENIAL_LINE })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, timedOut: true, output: DENIAL_LINE })).toBeUndefined()
    expect(detectSandboxDenial({ ...base, aborted: true, output: DENIAL_LINE })).toBeUndefined()
  })

  test("read-only isolation mode never escalates", () => {
    const readOnly: Isolation.State = { ...workspaceWrite, mode: "read-only" }
    expect(detectSandboxDenial({ ...base, isolation: readOnly, output: DENIAL_LINE })).toBeUndefined()
  })
})

describe("tool.bash sandbox-denial escalation", () => {
  test("denial signature triggers exactly one escalation ask and retries relaxed on approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        vi.spyOn(OsSandbox, "wrapCommand").mockReturnValue(fakeFailingWrap(DENIAL_LINE))
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: "echo relaxed-retry-ok", description: "Retry after sandbox denial" },
          {
            ...ctx,
            extra: { isolation },
            ask: async (req: PermissionRequest) => {
              asks.push(req)
            },
          },
        )

        const escalations = asks.filter((r) => r.permission === "isolation_escalation")
        expect(escalations).toHaveLength(1)
        expect(escalations[0]!.patterns).toContain("echo relaxed-retry-ok")
        expect(escalations[0]!.metadata).toMatchObject({
          reason: "os_sandbox_denial",
          mechanism: "seatbelt",
          requireInteractive: true,
        })
        // The relaxed retry ran the real command unsandboxed and succeeded.
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("relaxed-retry-ok")
      },
    })
  })

  test("ask denied returns the original failure unchanged, no retry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        vi.spyOn(OsSandbox, "wrapCommand").mockReturnValue(fakeFailingWrap(DENIAL_LINE))
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: "echo should-not-run", description: "Deny sandbox escalation" },
          {
            ...ctx,
            extra: { isolation },
            ask: async (req: PermissionRequest) => {
              asks.push(req)
              if (req.permission === "isolation_escalation") throw new Permission.RejectedError()
            },
          },
        )

        expect(asks.filter((r) => r.permission === "isolation_escalation")).toHaveLength(1)
        // Original failure shape: non-zero exit, denial output, no relaxed run.
        expect(result.metadata.exit).toBe(1)
        expect(result.output).toContain("Operation not permitted")
        expect(result.output).not.toContain("should-not-run\n")
      },
    })
  })

  test("sandboxed run failing without a denial signature never asks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        vi.spyOn(OsSandbox, "wrapCommand").mockReturnValue(fakeFailingWrap("boom: ordinary failure"))
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: "echo never-runs", description: "Ordinary sandboxed failure" },
          {
            ...ctx,
            extra: { isolation },
            ask: async (req: PermissionRequest) => {
              asks.push(req)
            },
          },
        )

        expect(result.metadata.exit).toBe(1)
        expect(result.output).toContain("boom: ordinary failure")
        expect(asks.some((r) => r.permission === "isolation_escalation")).toBe(false)
      },
    })
  })

  test("ordinary kill EPERM from a wrapped run never asks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        vi.spyOn(OsSandbox, "wrapCommand").mockReturnValue(fakeFailingWrap("kill: (1) - Operation not permitted"))
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: "kill -HUP 1", description: "Signal a privileged pid" },
          {
            ...ctx,
            extra: { isolation },
            ask: async (req: PermissionRequest) => {
              asks.push(req)
            },
          },
        )

        expect(result.metadata.exit).toBe(1)
        expect(result.output).toContain("Operation not permitted")
        expect(asks.some((r) => r.permission === "isolation_escalation")).toBe(false)
      },
    })
  })

  test("plain failing command without a wrap never asks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: "false", description: "Plain exit 1" },
          {
            ...ctx,
            ask: async (req: PermissionRequest) => {
              asks.push(req)
            },
          },
        )

        expect(result.metadata.exit).toBe(1)
        expect(asks.some((r) => r.permission === "isolation_escalation")).toBe(false)
      },
    })
  })

  test("denial output without an applied sandbox wrap never asks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        // Wrap resolves inactive (backend unavailable) — the command runs
        // unsandboxed, so sandbox-denial-looking output is just output.
        vi.spyOn(OsSandbox, "wrapCommand").mockReturnValue({ active: false, reason: "unavailable in test" })
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: `echo "${DENIAL_LINE}" >&2 && exit 1`, description: "Unwrapped denial-looking failure" },
          {
            ...ctx,
            extra: { isolation },
            ask: async (req: PermissionRequest) => {
              asks.push(req)
            },
          },
        )

        expect(result.metadata.exit).toBe(1)
        expect(result.output).toContain("Operation not permitted")
        expect(asks.some((r) => r.permission === "isolation_escalation")).toBe(false)
      },
    })
  })

  test("read-only mode never asks and never wraps", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "read-only" }, tmp.path, tmp.path)
        const wrapSpy = vi.spyOn(OsSandbox, "wrapCommand")
        const asks: PermissionRequest[] = []
        await expect(
          bash.execute(
            { command: "echo nope", description: "Bash in read-only mode" },
            {
              ...ctx,
              extra: { isolation },
              ask: async (req: PermissionRequest) => {
                asks.push(req)
              },
            },
          ),
        ).rejects.toThrow(/read-only/)

        expect(wrapSpy).not.toHaveBeenCalled()
        expect(asks.some((r) => r.permission === "isolation_escalation")).toBe(false)
      },
    })
  })

  test("synchronous spawn throw still cleans up the seatbelt profile", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        // A non-string file makes child_process.spawn throw synchronously
        // (ERR_INVALID_ARG_TYPE), bypassing the async close/error listeners
        // that normally run cleanupProfile.
        const throwingWrap: OsSandbox.WrapResult = {
          active: true,
          mechanism: "seatbelt",
          file: 123 as unknown as string,
          args: [],
          shell: false,
          profilePath: "/tmp/ax-code-test-sync-throw-profile.sb",
        }
        vi.spyOn(OsSandbox, "wrapCommand").mockReturnValue(throwingWrap)
        const cleanup = vi.spyOn(OsSandbox, "cleanupProfile").mockImplementation(() => {})

        await expect(
          bash.execute(
            { command: "echo never-runs", description: "Synchronous spawn throw" },
            { ...ctx, extra: { isolation } },
          ),
        ).rejects.toThrow()

        expect(cleanup).toHaveBeenCalledWith("/tmp/ax-code-test-sync-throw-profile.sb")
      },
    })
  })
})
