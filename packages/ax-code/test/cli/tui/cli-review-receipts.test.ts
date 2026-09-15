import { describe, expect, test } from "vitest"
import { extractVerdicts, parseArgs } from "../../../script/verify-cli-review-receipts"

describe("CLI review receipt verdict extraction", () => {
  test("reassembles a grok streaming JSONL verdict from text events only", () => {
    // Regression: the verifier joined every `data` field with a newline, which
    // both pulled in `thought` text and split the verdict JSON, so grok's
    // answer never parsed. Text fragments must be concatenated with no
    // separator and thought/control events ignored.
    const verdict = {
      verdict: "findings",
      reviewed_revision: "7fb799e6615a08648554277ebb6924d0bb448903",
      findings: [
        {
          id: "F1",
          severity: "high",
          file: "packages/ax-code/src/cli/tui/component/digital-code-view-model.ts",
          line: 283,
          summary: "example",
          evidence: "example",
        },
      ],
    }
    const json = JSON.stringify(verdict)
    const events = [
      JSON.stringify({ type: "available_commands", tools: ["read_file"], commands: [] }),
      JSON.stringify({ type: "thought", data: `thinking about ${json.slice(0, 10)}` }),
      JSON.stringify({ type: "text", data: json.slice(0, 11) }),
      JSON.stringify({ type: "text", data: json.slice(11, 37) }),
      JSON.stringify({ type: "text", data: json.slice(37) }),
    ]
    const verdicts = extractVerdicts(events.join("\n"), "jsonl")
    expect(verdicts).toHaveLength(1)
    const last = verdicts.at(-1)!
    expect(last.verdict).toBe("findings")
    expect(last.reviewedRevision).toBe("7fb799e6615a08648554277ebb6924d0bb448903")
    expect(last.findings.map((finding) => finding.id)).toEqual(["F1"])
    expect(last.findings[0]!.line).toBe(283)
  })

  test("still reads a plain-text final verdict", () => {
    const raw = 'I found no defects.\n\n{"verdict":"no_findings","reviewed_revision":"abc1234","findings":[]}\n'
    const verdicts = extractVerdicts(raw)
    expect(verdicts.at(-1)).toMatchObject({ verdict: "no_findings", reviewedRevision: "abc1234", findings: [] })
  })

  test("keeps the last verdict when several appear", () => {
    const first =
      '{"verdict":"findings","reviewed_revision":"aaaaaaa","findings":[{"id":"F1","severity":"low","file":"a.ts","line":1,"summary":"s"}]}'
    const second = '{"verdict":"no_findings","reviewed_revision":"bbbbbbb","findings":[]}'
    const verdicts = extractVerdicts(`${first}\n${second}\n`)
    expect(verdicts).toHaveLength(2)
    expect(verdicts.at(-1)!.verdict).toBe("no_findings")
  })

  test("reassembles a muse durable-JSONL verdict from output deltas only", () => {
    // Regression: muse streams the answer as `run.output.delta` payloads and
    // repeats it on `run.terminal.completed`. Concatenating both would yield two
    // verdicts and fail the verifier as ambiguous, so the deltas must win alone.
    const verdict = {
      verdict: "findings",
      reviewed_revision: "0123456789abcdef0123456789abcdef01234567",
      findings: [
        {
          id: "M1",
          severity: "medium",
          file: "packages/ax-code/src/cli/tui/component/animation-pair.ts",
          line: 42,
          summary: "example",
        },
      ],
    }
    const json = JSON.stringify(verdict)
    const events = [
      JSON.stringify({ payload_type: "run.model.configured", payload: { kind: "run_model_configured" } }),
      JSON.stringify({
        payload_type: "run.output.delta",
        payload: { kind: "run_output_delta", text: json.slice(0, 9) },
      }),
      JSON.stringify({
        payload_type: "run.output.delta",
        payload: { kind: "run_output_delta", text: json.slice(9, 40) },
      }),
      JSON.stringify({ payload_type: "run.output.delta", payload: { kind: "run_output_delta", text: json.slice(40) } }),
      JSON.stringify({
        payload_type: "run.terminal.completed",
        payload: { kind: "run_terminal", terminal: "completed", text: json },
      }),
    ]
    const verdicts = extractVerdicts(events.join("\n"), "muse-jsonl")
    expect(verdicts).toHaveLength(1)
    const last = verdicts.at(-1)!
    expect(last.verdict).toBe("findings")
    expect(last.reviewedRevision).toBe("0123456789abcdef0123456789abcdef01234567")
    expect(last.findings.map((finding) => finding.id)).toEqual(["M1"])
  })

  test("falls back to muse terminal text when no deltas were emitted", () => {
    const raw = JSON.stringify({
      payload_type: "run.terminal.completed",
      payload: {
        kind: "run_terminal",
        terminal: "completed",
        text: '{"verdict":"no_findings","reviewed_revision":"abcdef0","findings":[]}',
      },
    })
    const verdicts = extractVerdicts(`${raw}\n`, "muse-jsonl")
    expect(verdicts.at(-1)).toMatchObject({ verdict: "no_findings", reviewedRevision: "abcdef0", findings: [] })
  })
})

describe("CLI review receipt argument parsing", () => {
  test("defaults to the grok/claude/codex roster", () => {
    const args = parseArgs([], "/repo")
    expect(args.clis).toEqual(["grok", "claude", "codex"])
  })

  test("accepts an explicit --clis roster and trims separators", () => {
    const args = parseArgs(["--root", "/receipts", "--clis", "muse, claude ,codex"], "/repo")
    expect(args.clis).toEqual(["muse", "claude", "codex"])
    expect(args.root).toBe("/receipts")
  })
})
