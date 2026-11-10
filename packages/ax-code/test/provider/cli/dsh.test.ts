import { readFile, writeFile } from "fs/promises"
import { describe, expect, test } from "vitest"
import { buildCliCommand, cliEnv } from "../../../src/provider/cli/cli-language-model"
import { CLI_PROVIDER_DEFINITIONS } from "../../../src/provider/cli/config"
import { DSH_PRIVACY_PATCH, dshPrivacyPatchPath, ensureDshPrivacyPatch } from "../../../src/provider/cli/dsh"
import { CliOutputError, dshCliParser } from "../../../src/provider/cli/parser"

// Event shapes captured from `dsh --profile headless --json` 0.2.2-rc.1.
const session = '{"type":"session","sessionId":"session-1","cwd":"/work"}'
const completed = [
  session,
  '{"type":"status","phase":"turn_start","turn":1}',
  '{"type":"thinking","text":""}',
  '{"type":"tool_call","callId":"call_1","tool":"read","input":{"file_path":"/work/note.txt"}}',
  '{"type":"tool_result","callId":"call_1","status":"completed","result":"1: secret-word: PELICAN-42"}',
  '{"type":"text","text":"PELICAN-42"}',
  '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}',
  '{"type":"final","sessionId":"session-1","reason":{"kind":"completed"},"text":"PELICAN-42"}',
].join("\n")

function failedFinal(code: string, message: string) {
  return [
    session,
    `{"type":"final","sessionId":"session-1","reason":{"kind":"error","error":{"message":"${message}","code":"${code}"}},"text":""}`,
  ].join("\n")
}

describe("dshCliParser", () => {
  test("returns the final answer of a completed run", () => {
    expect(dshCliParser.parseComplete(completed)).toEqual({ text: "PELICAN-42" })
  })

  test("streams assistant text and ignores tool, status, and final events", () => {
    const deltas = completed
      .split("\n")
      .map((line) => dshCliParser.parseStreamLine(line))
      .filter((delta) => delta !== null)
    expect(deltas).toEqual(["PELICAN-42"])
  })

  test("turns a missing API key into a non-retryable setup hint", () => {
    const run = () => dshCliParser.parseComplete(failedFinal("MISSING_CREDENTIAL", "no API key"))
    expect(run).toThrow(CliOutputError)
    expect(run).toThrow(/DEEPSEEK_API_KEY/)
  })

  test("reports other terminal errors with their code", () => {
    expect(() => dshCliParser.parseComplete(failedFinal("RATE_LIMITED", "slow down"))).toThrow(
      "DeepSeek Harness run failed: RATE_LIMITED: slow down",
    )
  })

  test("falls back to streamed text when final carries none", () => {
    const output = [session, '{"type":"text","text":"partial"}', '{"type":"final","reason":{"kind":"completed"}}'].join(
      "\n",
    )
    expect(dshCliParser.parseComplete(output)).toEqual({ text: "partial" })
  })
})

describe("dsh-cli command", () => {
  test("puts the privacy patch before --profile and keeps the task off argv", () => {
    const definition = CLI_PROVIDER_DEFINITIONS["dsh-cli"]!
    const cmd = buildCliCommand(
      {
        providerID: "dsh-cli",
        modelID: "dsh-cli",
        binary: "dsh",
        args: definition.args,
        parser: definition.parser,
        promptMode: definition.promptMode,
      },
      "summarize the repository",
    )
    expect(cmd.slice(0, 3)).toEqual(["dsh", "--patch", dshPrivacyPatchPath()])
    expect(cmd.indexOf("--patch")).toBeLessThan(cmd.indexOf("--profile"))
    expect(cmd).toEqual(expect.arrayContaining(["--json", "--approval-policy", "never"]))
    expect(cmd).not.toContain("--model")
    expect(cmd).not.toContain("summarize the repository")
  })

  test("disables dsh OTel telemetry in the child environment", () => {
    expect(cliEnv([], "dsh-cli").DSH_TELEMETRY_MODE).toBe("DISABLED")
    expect(cliEnv([], "codex-cli").DSH_TELEMETRY_MODE).toBeUndefined()
  })

  test("writes the privacy patch and repairs a modified copy", async () => {
    await ensureDshPrivacyPatch()
    expect(await readFile(dshPrivacyPatchPath(), "utf8")).toBe(DSH_PRIVACY_PATCH)
    await writeFile(dshPrivacyPatchPath(), "- id: session-log-deepseek\n  disabled: false\n")
    await ensureDshPrivacyPatch()
    expect(await readFile(dshPrivacyPatchPath(), "utf8")).toBe(DSH_PRIVACY_PATCH)
    expect(DSH_PRIVACY_PATCH).toContain("- id: session-log-deepseek\n  disabled: true")
    expect(DSH_PRIVACY_PATCH).toContain("- id: session-telemetry-otel\n  disabled: true")
  })
})
