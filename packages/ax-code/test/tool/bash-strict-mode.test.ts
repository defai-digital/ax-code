import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Permission } from "../../src/permission"
import { Config } from "../../src/config/config"
import { SessionID, MessageID } from "../../src/session/schema"
import { denyDestructiveInOpsStrict } from "../../src/tool/bash-strict"

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

function makeCtx(asks: PermissionRequest[]) {
  return {
    sessionID: SessionID.make("ses_strict_mode"),
    messageID: MessageID.make(""),
    callID: "",
    agent: "cloudops",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async (req?: PermissionRequest) => {
      if (req) asks.push(req)
    },
  }
}

async function withTrustedProjectConfig<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.AX_CODE_TRUST_PROJECT_CONFIG
  process.env.AX_CODE_TRUST_PROJECT_CONFIG = "1"
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env.AX_CODE_TRUST_PROJECT_CONFIG
    else process.env.AX_CODE_TRUST_PROJECT_CONFIG = original
  }
}

describe("denyDestructiveInOpsStrict", () => {
  const commands = new Map([
    ["aws ec2 terminate-instances --instance-ids i-0", "aws ec2 terminate-instances deletes cloud resources"],
    ["kubectl delete namespace staging", "kubectl delete removes cluster objects"],
  ])

  test("throws the typed permission DeniedError used by SafetyPolicy", () => {
    let caught: unknown
    try {
      denyDestructiveInOpsStrict(commands)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Permission.DeniedError)
    expect((caught as Error).name).toBe("PermissionDeniedError")
  })

  test("message lists the classified commands and reasons, and points to the ops workflow", () => {
    let message = ""
    try {
      denyDestructiveInOpsStrict(commands)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("strict mode")
    for (const [command, reason] of commands) {
      expect(message).toContain(command)
      expect(message).toContain(reason)
    }
    expect(message).toContain("ops_plan")
    expect(message).toContain("ops_diff")
    expect(message).toContain("ops_approve")
    expect(message).toContain("ops_apply")
  })

  test("carries a bash_destructive deny ruleset like enforceSafetyPolicy", () => {
    let error: Permission.DeniedError | undefined
    try {
      denyDestructiveInOpsStrict(commands)
    } catch (caught) {
      error = caught as Permission.DeniedError
    }
    expect(error?.ruleset).toEqual([
      expect.objectContaining({ permission: "bash_destructive", action: "deny", pattern: "*" }),
    ])
  })
})

describe("ops.strict bash integration", () => {
  test("strict on + destructive command: hard deny before any ask, command not executed", async () => {
    await using tmp = await tmpdir({ git: true, config: { ops: { strict: true } } })
    await withTrustedProjectConfig(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const asks: PermissionRequest[] = []
          await expect(
            bash.execute(
              { command: "rm -rf ./strict-mode-target && touch ./should-not-exist", description: "Remove target" },
              makeCtx(asks),
            ),
          ).rejects.toBeInstanceOf(Permission.DeniedError)
          // The deny replaces the ask entirely — no permission request is made.
          expect(asks).toEqual([])
          await expect(fs.stat(path.join(tmp.path, "should-not-exist"))).rejects.toThrow()
        },
      }),
    )
  }, 30_000)

  test("strict on + benign command: unaffected", async () => {
    await using tmp = await tmpdir({ git: true, config: { ops: { strict: true } } })
    await withTrustedProjectConfig(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const asks: PermissionRequest[] = []
          const result = await bash.execute({ command: "echo ok", description: "Echo ok" }, makeCtx(asks))
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("ok")
          expect(asks.filter((ask) => ask.permission === "bash_destructive")).toEqual([])
        },
      }),
    )
  })

  test("strict off + destructive command: existing ask flow is unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const asks: PermissionRequest[] = []
        const result = await bash.execute(
          { command: "rm -rf ./strict-mode-target", description: "Remove target" },
          makeCtx(asks),
        )
        expect(result.metadata.exit).toBe(0)
        const destructive = asks.filter((ask) => ask.permission === "bash_destructive")
        expect(destructive).toHaveLength(1)
        expect(destructive[0]!.always).toEqual([])
        expect(destructive[0]!.patterns).toContain("rm -rf ./strict-mode-target")
      },
    })
  })

  test("ops_apply does not consult the bash strict flag", async () => {
    const source = await fs.readFile(path.join(__dirname, "../../src/tool/ops_apply.ts"), "utf-8")
    expect(source).not.toContain("bash-strict")
    expect(source).not.toContain("denyDestructiveInOpsStrict")
    expect(source).not.toContain("ops.strict")
  })
})

describe("ops.strict trust scoping", () => {
  test("untrusted project config cannot enable strict mode", async () => {
    await using tmp = await tmpdir({ git: true, config: { ops: { strict: true } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.ops?.strict).toBeUndefined()
      },
    })
  })

  test("trusted project config can enable strict mode", async () => {
    await using tmp = await tmpdir({ git: true, config: { ops: { strict: true } } })
    await withTrustedProjectConfig(() =>
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.ops?.strict).toBe(true)
        },
      }),
    )
  })
})
