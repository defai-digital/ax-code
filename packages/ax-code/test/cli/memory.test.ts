import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as prompts from "@clack/prompts"
import { tmpdir } from "../fixture/fixture"
import { MemoryDoctorCommand, MemoryRecallCommand, MemoryRememberCommand } from "../../src/cli/cmd/memory"

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
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
})
