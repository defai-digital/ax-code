import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionVerifications } from "../../src/session/verifications"
import { tmpdir } from "../fixture/fixture"

function buildEnvelope(overrides: Partial<VerificationEnvelope> = {}): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "qa",
    scope: { kind: "file", paths: ["src/foo.ts"] },
    command: { runner: "typecheck", argv: [], cwd: "/tmp/work" },
    result: {
      name: "typecheck",
      type: "typecheck",
      passed: true,
      status: "passed",
      issues: [],
      duration: 0,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "refactor_apply", version: "4.x.x", runId: "ses_test" },
    ...overrides,
  }
}

describe("SessionVerifications.load", () => {
  test("returns [] for a session with no verification-emitting tool calls", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: session.id,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(SessionVerifications.load(session.id)).toEqual([])
      },
    })
  })

  test("flattens metadata.verificationEnvelopes from refactor_apply tool.result events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tc = buildEnvelope({
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })
        const lint = buildEnvelope({
          command: { runner: "lint", argv: [], cwd: "/tmp/work" },
          result: { ...tc.result, name: "lint", type: "lint" },
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-apply-1",
          status: "completed",
          metadata: { verificationEnvelopes: [tc, lint] },
          durationMs: 100,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: session.id,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const envs = SessionVerifications.load(session.id)
        expect(envs).toHaveLength(2)
        expect(envs[0].command.runner).toBe("typecheck")
        expect(envs[1].command.runner).toBe("lint")
      },
    })
  })

  test("is tool-name agnostic — picks up envelopes from any tool that emits the metadata key", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const env = buildEnvelope({
          source: { tool: "future_tool", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "future_qa_runner",
          callID: "call-future",
          status: "completed",
          metadata: { verificationEnvelopes: [env] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const envs = SessionVerifications.load(session.id)
        expect(envs).toHaveLength(1)
      },
    })
  })

  test("ignores tool.result events without metadata.verificationEnvelopes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "bash",
          callID: "call-bash",
          status: "completed",
          output: "ok",
          metadata: {},
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(SessionVerifications.load(session.id)).toEqual([])
      },
    })
  })

  test("skips malformed entries inside metadata.verificationEnvelopes but keeps valid siblings", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const good = buildEnvelope({
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })
        const malformed = { workflow: "qa", schemaVersion: 99 } // invalid

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-mixed",
          status: "completed",
          metadata: { verificationEnvelopes: [good, malformed] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const envs = SessionVerifications.load(session.id)
        expect(envs).toHaveLength(1)
        expect(envs[0].source.runId).toBe(session.id)
      },
    })
  })

  test("loadWithIds attaches deterministic envelopeId to each loaded envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const env = buildEnvelope({
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-load-ids",
          status: "completed",
          metadata: { verificationEnvelopes: [env] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const loaded = SessionVerifications.loadWithIds(session.id)
        expect(loaded).toHaveLength(1)
        expect(loaded[0].envelopeId).toBe(computeEnvelopeId(env))
        expect(loaded[0].envelope).toEqual(env)
      },
    })
  })

  test("loadRunsWithIds preserves the tool.result verification set boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tc = buildEnvelope({
          source: { tool: "verify_project", version: "4.x.x", runId: session.id },
        })
        const tests = buildEnvelope({
          command: { runner: "test", argv: [], cwd: "/tmp/work" },
          result: { ...tc.result, name: "tests", type: "test", passed: false, status: "failed" },
          structuredFailures: [{ kind: "test", testName: "worker pool recovers", framework: "bun" }],
          source: { tool: "verify_project", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "verify_project",
          callID: "call-verify",
          status: "completed",
          metadata: { verificationEnvelopes: [tc, tests] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const runs = SessionVerifications.loadRunsWithIds(session.id)
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({ tool: "verify_project", callID: "call-verify" })
        expect(runs[0].envelopes.map((item) => item.envelopeId)).toEqual([
          computeEnvelopeId(tc),
          computeEnvelopeId(tests),
        ])
      },
    })
  })

  test("envelopeIdSet returns the set of all envelope ids in the session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const a = buildEnvelope({
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })
        const b = buildEnvelope({
          command: { runner: "lint", argv: [], cwd: "/tmp/work" },
          result: { ...a.result, name: "lint", type: "lint" },
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-set",
          status: "completed",
          metadata: { verificationEnvelopes: [a, b] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const ids = SessionVerifications.envelopeIdSet(session.id)
        expect(ids.size).toBe(2)
        expect(ids.has(computeEnvelopeId(a))).toBe(true)
        expect(ids.has(computeEnvelopeId(b))).toBe(true)
        expect(ids.has("0000000000000000")).toBe(false)
      },
    })
  })

  test("dedups envelopes by computeEnvelopeId across multiple tool.result emits", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const env = buildEnvelope({
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        // Same envelope emitted twice (re-run of refactor_apply)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-1",
          status: "completed",
          metadata: { verificationEnvelopes: [env] },
          durationMs: 1,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-2",
          status: "completed",
          metadata: { verificationEnvelopes: [env] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const envs = SessionVerifications.load(session.id)
        expect(envs).toHaveLength(1)
      },
    })
  })

  test("ignores tool.result events with status: 'error'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const env = buildEnvelope({
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "refactor_apply",
          callID: "call-err",
          status: "error",
          metadata: { verificationEnvelopes: [env] },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(SessionVerifications.load(session.id)).toEqual([])
      },
    })
  })
})
