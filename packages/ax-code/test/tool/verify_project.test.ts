import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { ENVELOPE_ID_PATTERN } from "../../src/quality/verification-envelope"
import { VerifyProjectTool } from "../../src/tool/verify_project"
import { tmpdir } from "../fixture/fixture"

function ctx(asks: any[] = []) {
  return {
    sessionID: "ses_test_verify_project",
    messageID: "msg_test" as any,
    agent: "build",
    abort: new AbortController().signal,
    callID: "call_test",
    messages: [],
    metadata: () => {},
    ask: async (input: any) => {
      asks.push(input)
    },
  } as any
}

afterEach(async () => {
  await Instance.disposeAll()
})

async function writeFile(dir: string, relPath: string, contents: string) {
  const full = path.join(dir, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, contents, "utf8")
}

describe("VerifyProjectTool", () => {
  test("runs configured checks and emits verification envelopes with ids", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = `bun -e "console.error('src/foo.ts(2,3): error TS2345: wrong type'); process.exit(1)"`
        const asks: any[] = []
        const tool = await VerifyProjectTool.init()

        const result = await tool.execute(
          {
            workflow: "review",
            paths: ["src/foo.ts"],
            commands: {
              typecheck: command,
              lint: null,
              test: null,
            },
          },
          ctx(asks),
        )

        expect(asks).toHaveLength(1)
        expect(asks[0]).toMatchObject({
          permission: "bash",
          patterns: [command],
          always: [command],
        })
        expect(result.title).toBe("verify_project failed")
        expect(result.metadata.passed).toBe(false)
        expect(result.metadata.envelopeIds).toHaveLength(3)
        expect(result.metadata.envelopeIds[0].envelopeId).toMatch(ENVELOPE_ID_PATTERN)
        expect(result.metadata.verificationEnvelopes).toHaveLength(3)

        const typecheck = result.metadata.verificationEnvelopes.find((env: any) => env.result.name === "typecheck")
        if (!typecheck) throw new Error("missing typecheck envelope")
        expect(typecheck.result.status).toBe("failed")
        expect(typecheck.workflow).toBe("review")
        expect(typecheck.scope).toEqual({ kind: "file", paths: ["src/foo.ts"] })
        expect(typecheck.command.argv).toEqual(["sh", "-c", command])
        expect(typecheck.source.tool).toBe("verify_project")
        expect(typecheck.structuredFailures[0]).toMatchObject({
          kind: "typecheck",
          file: "src/foo.ts",
          line: 2,
          column: 3,
          code: "TS2345",
        })
        expect(result.output).toContain(result.metadata.envelopeIds[0].envelopeId)
      },
    })
  })

  test("skips permission prompt when every check is skipped", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asks: any[] = []
        const tool = await VerifyProjectTool.init()

        const result = await tool.execute(
          {
            scopeDescription: "manual QA smoke scope",
            commands: {
              typecheck: null,
              lint: null,
              test: null,
            },
          },
          ctx(asks),
        )

        expect(asks).toHaveLength(0)
        expect(result.title).toBe("verify_project passed")
        expect(result.metadata.passed).toBe(true)
        expect(result.metadata.verificationEnvelopes.map((env: any) => env.result.status)).toEqual([
          "skipped",
          "skipped",
          "skipped",
        ])
        expect(result.metadata.verificationEnvelopes[0].scope).toEqual({
          kind: "custom",
          description: "manual QA smoke scope",
        })
      },
    })
  })

  test("review policy required_checks make skipped required checks fail the run", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ required_checks: ["test"] }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asks: any[] = []
        const tool = await VerifyProjectTool.init()

        const result = await tool.execute(
          {
            workflow: "review",
            commands: {
              typecheck: null,
              lint: null,
              test: null,
            },
          },
          ctx(asks),
        )

        expect(asks).toHaveLength(0)
        expect(result.title).toBe("verify_project failed")
        expect(result.metadata.passed).toBe(false)
        expect(result.metadata.policy).toMatchObject({
          requiredChecksPassed: false,
          missingRequiredChecks: ["test"],
          rules: { required_checks: ["test"] },
        })
        expect(result.output).toContain("Policy required checks: test")
        expect(result.output).toContain("Policy missing required checks: test")
      },
    })
  })

  test("debug workflow does not inherit review or qa required_checks", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ required_checks: ["typecheck"] }))
    await writeFile(tmp.path, ".ax-code/qa.rules.json", JSON.stringify({ required_checks: ["test"] }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await VerifyProjectTool.init()

        const result = await tool.execute(
          {
            workflow: "debug",
            commands: {
              typecheck: null,
              lint: null,
              test: null,
            },
          },
          ctx(),
        )

        expect(result.title).toBe("verify_project passed")
        expect(result.metadata.passed).toBe(true)
        expect(result.metadata.policy).toBeUndefined()
        expect(result.output).not.toContain("Policy required checks")
      },
    })
  })
})
