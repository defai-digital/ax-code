import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as prompts from "@clack/prompts"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import {
  MemoryDoctorCommand,
  MemoryEvalCommand,
  MemoryRecallCommand,
  MemoryRememberCommand,
  applyMemoryDoctorExitCode,
  applyMemoryEvalExitCode,
} from "../../src/cli/cmd/memory"

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  process.exitCode = undefined
  mock.restore()
})

describe("memory command", () => {
  test("remember and recall expose scoped metadata and explain output", async () => {
    await using tmp = await tmpdir()
    process.chdir(tmp.path)

    spyOn(prompts, "intro").mockImplementation(() => {})
    spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = spyOn(prompts.log, "info").mockImplementation(() => {})
    spyOn(prompts.log, "success").mockImplementation(() => {})

    await MemoryRememberCommand.handler({
      kind: "feedback",
      name: "focused-recall",
      body: "Prefer focused memory recall",
      tags: "memory,ranking",
      paths: "src\\**\\*.ts",
      expiresAt: "2030-01-01T00:00:00.000Z",
      confidence: 0.8,
      sourceSession: "ses_1",
      global: false,
    } as any)

    await MemoryRecallCommand.handler({
      query: "focused recall",
      tags: "memory,ranking",
      path: `${tmp.path}/src/memory/recall.ts`,
      explain: true,
      includeExpired: false,
      scope: "project",
      global: false,
    } as any)

    const output = infoSpy.mock.calls.map(([message]) => String(message)).join("\n")
    expect(output).toContain("focused-recall")
    expect(output).toContain("tags: memory, ranking")
    expect(output).toContain("paths: src/**/*.ts")
    expect(output).toContain("explain:")
  })

  test("doctor command reports healthy empty project memory", async () => {
    await using tmp = await tmpdir()
    process.chdir(tmp.path)

    spyOn(prompts, "intro").mockImplementation(() => {})
    spyOn(prompts, "outro").mockImplementation(() => {})
    const infoSpy = spyOn(prompts.log, "info").mockImplementation(() => {})
    const successSpy = spyOn(prompts.log, "success").mockImplementation(() => {})

    await MemoryDoctorCommand.handler({ scope: "project" } as any)

    expect(infoSpy.mock.calls.some(([message]) => String(message).includes("Status: ok"))).toBe(true)
    expect(successSpy.mock.calls.some(([message]) => String(message).includes("No memory issues found"))).toBe(true)
  })

  test("recall --json emits parseable results without clack output", async () => {
    await using tmp = await tmpdir()
    process.chdir(tmp.path)

    const introSpy = spyOn(prompts, "intro").mockImplementation(() => {})
    spyOn(prompts, "outro").mockImplementation(() => {})
    spyOn(prompts.log, "success").mockImplementation(() => {})
    const logSpy = spyOn(console, "log").mockImplementation(() => {})

    await MemoryRememberCommand.handler({
      kind: "feedback",
      name: "json-recall",
      body: "Machine readable recall",
      global: false,
    } as any)
    introSpy.mockClear()
    logSpy.mockClear()

    await MemoryRecallCommand.handler({
      query: "machine",
      scope: "project",
      json: true,
    } as any)

    expect(introSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(parsed.count).toBe(1)
    expect(parsed.results[0].entry.name).toBe("json-recall")
  })

  test("doctor --json emits parseable report without clack output", async () => {
    await using tmp = await tmpdir()
    process.chdir(tmp.path)

    const introSpy = spyOn(prompts, "intro").mockImplementation(() => {})
    const logSpy = spyOn(console, "log").mockImplementation(() => {})

    await MemoryDoctorCommand.handler({ scope: "project", json: true } as any)

    expect(introSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(parsed.status).toBe("ok")
    expect(parsed.checked.project).toBe(true)
  })

  test("doctor exit helper honors fail-on thresholds", () => {
    const warnTarget: { exitCode?: number | string | undefined } = {}
    const errorOnlyTarget: { exitCode?: number | string | undefined } = {}
    const neverTarget: { exitCode?: number | string | undefined } = {}

    applyMemoryDoctorExitCode({ status: "warn" }, "warn", warnTarget)
    applyMemoryDoctorExitCode({ status: "warn" }, "error", errorOnlyTarget)
    applyMemoryDoctorExitCode({ status: "error" }, "never", neverTarget)

    expect(warnTarget.exitCode).toBe(1)
    expect(errorOnlyTarget.exitCode).toBeUndefined()
    expect(neverTarget.exitCode).toBeUndefined()
  })

  test("eval --json emits parseable recall metrics", async () => {
    await using tmp = await tmpdir()
    process.chdir(tmp.path)

    spyOn(prompts, "intro").mockImplementation(() => {})
    spyOn(prompts, "outro").mockImplementation(() => {})
    spyOn(prompts.log, "success").mockImplementation(() => {})
    const logSpy = spyOn(console, "log").mockImplementation(() => {})

    await MemoryRememberCommand.handler({
      kind: "feedback",
      name: "eval-target",
      body: "Recall evaluation target",
      global: false,
    } as any)
    logSpy.mockClear()

    const casesPath = path.join(tmp.path, "memory-cases.json")
    await Bun.write(
      casesPath,
      JSON.stringify({
        cases: [{ query: "evaluation", expected: ["eval-target"] }],
      }),
    )

    await MemoryEvalCommand.handler({
      cases: casesPath,
      limit: 3,
      scope: "project",
      minMrr: 1,
      json: true,
    } as any)

    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0]))
    expect(parsed.total).toBe(1)
    expect(parsed.passed).toBe(1)
    expect(parsed.recallAtK).toBe(1)
    expect(parsed.meanReciprocalRank).toBe(1)
    expect(parsed.minMrr).toBe(1)
    expect(parsed.passedThreshold).toBe(true)
    expect(parsed.cases[0].firstHitRank).toBe(1)
  })

  test("eval threshold helper marks failing runs with exit code", () => {
    const target: { exitCode?: number | string | undefined } = {}

    applyMemoryEvalExitCode({ passedThreshold: false }, target)

    expect(target.exitCode).toBe(1)
  })
})
