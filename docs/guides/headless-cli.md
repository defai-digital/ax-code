# Headless CLI (`ax-code run`)

Status: Active
Scope: current-state
Last reviewed: 2026-09-22
Owner: AX Code runtime maintainers

`ax-code run` is the one-shot, non-interactive entry point for AI coding agents and scripts. It submits a single
prompt, prints the assistant's final reply, and exits — no terminal UI, no interactive prompts. This guide covers the
option surface, output contract, exit codes, and copy-paste recipes for scripting and CI.

## Invoking a run

There are four ways to supply the prompt. They compose in order: `--prompt-file`, then `-p/--prompt`, then the positional
message, then piped stdin.

```bash
# Positional after -- (safest; flags after -- are never consumed as options)
ax-code run --model qwen -- "Review this change"

# Explicit prompt flag
ax-code run --model qwen --prompt "Review this change"
ax-code run --model qwen -p "Review this change"

# Prompt read from a file (not an attachment)
ax-code run --model qwen --prompt-file ./prompt.txt

# Piped stdin (used as the prompt when no positional/--prompt is given)
printf 'Review this change' | ax-code run --model qwen
```

When stdin is not a TTY, its contents are appended to the composed prompt, so it is the whole prompt when nothing else
is supplied. The stdin reader waits for a 300 ms quiet window before giving up on an open pipe, so write the prompt
promptly and close stdin — or use `--prompt-file` for large or slowly produced prompts.

`-f/--file` attaches files to the message and never replaces the prompt; it is repeatable:

```bash
ax-code run --model qwen --file README.md --file src/main.ts -- "Summarize these"
```

## Choosing a model

List usable IDs with `ax-code models`. Pass the resulting `provider/model` value to `--model` (`-m`):

```bash
ax-code models            # one "provider/model" ID per line
ax-code models --json     # one JSON document
```

`ax-code models --json` prints a single document of the form
`{"models":[{"id":"provider/model","provider":"...","model":"...","connected":true}]}`.

The family names `deepseek`, `glm`, and `qwen` resolve to their Flash defaults, so
`ax-code run --model qwen -- "..."` works without spelling out a full `provider/model` ID. Omitting `--model` uses the
configured default; the effective agent and model are printed to stderr as `> Agent · model`.

## Output formats

`--format` accepts `default` (the default), `json`, `jsonl`, or `ndjson` (`jsonl` and `ndjson` are aliases for `json`).

### Default (text)

The default format prints only the final assistant text on stdout. All progress, tool activity, and diagnostics go to
stderr. ANSI colors are disabled when stderr is not a TTY or when `NO_COLOR` is set (any value), so a piped run never
emits escape codes.

### JSON stream (`--format json`)

`--format json` prints a newline-delimited JSON (NDJSON) event stream — one JSON object per line, not a single JSON
document. Events include `step_start`, `text`, `tool_use`, `reasoning` (only with `--thinking`), `permission_denied`,
`error`, and `step_finish`. The stream always ends with exactly one `result` line:

```json
{
  "type": "result",
  "timestamp": 1727000000000,
  "sessionID": "ses_...",
  "status": "completed",
  "text": "...",
  "permissionDenials": 0,
  "usage": { "input": 1200, "output": 80, "reasoning": 0, "cacheRead": 0, "cacheWrite": 0 }
}
```

`status` is `completed`, `blocked`, or `error`. `usage` carries token counts only — `input`, `output`, `reasoning`,
`cacheRead`, `cacheWrite` — and is omitted entirely when the counts are unknown; there is no cost field. When a run
fails before submitting (bad flag, unknown model, etc.), the stream format prints one line before exiting:

```json
{ "type": "error", "error": { "code": "usage", "message": "..." } }
```

where `code` is `usage`, `provider`, or `model`.

## Exit codes

| Code | Meaning                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | Completed.                                                                                                    |
| 1    | Usage error, provider/model error, stream error, or `--output-schema` validation failure.                     |
| 3    | Blocked — at least one permission denial and no successful mutating tool call (`result.status` is `blocked`). |
| 124  | Timed out (`--timeout` elapsed; `result.status` is `timeout`).                                                |
| 130  | Cancelled by SIGINT (session aborted on the server; `result.status` is `cancelled`).                          |

## Sandbox

`--sandbox read-only|workspace-write|full-access` selects the isolation mode (default `full-access`). In headless runs
permission asks are auto-rejected and reported as `permission_denied` events, so a run that needs a write it was not
allowed to make reports `blocked` and exits 3. Use `read-only` only when no mutation is expected; `workspace-write`
keeps writes inside the project.

## Structured output

`-o/--output-file <path>` writes the final assistant text to a file. `--output-schema <file>` validates the final text
as JSON against a JSON Schema file and exits 1 on mismatch:

```bash
ax-code run --model qwen --output-schema ./answer.schema.json -- "Return a JSON object with a summary field"
```

## Sessions and resuming

- `-c/--continue` — continue the most recent session.
- `-s/--session <id>` — continue a specific session by ID.
- `--fork` — fork the session before continuing (requires `--continue` or `--session`).
- `--show-history` — print visible session history when resuming (requires `--continue` or `--session`).
- `--attach <url>` — attach to an already-running server instead of starting one; combine with `--dir` to target a
  project directory on that server.

## Recipes

### One-shot

```bash
ax-code run --model qwen -- "Fix the failing test in src/parser.ts"
```

### Bound a run with a timeout

```bash
ax-code run --timeout 120 --model qwen -- "Fix the failing test in src/parser.ts"
```

`--timeout <seconds>` aborts the run on the server and exits 124 (`result.status` is `timeout`) when the run outlives
the bound, so a stuck agent cannot hold a CI job open indefinitely.

### Parse the JSON stream

```bash
result=$(ax-code run --format json --model qwen -- "..." | tail -n 1)
echo "$result" | jq -r '.status'
echo "$result" | jq -r '.text'
```

The `result` line is always the last line, so `tail -n 1` isolates it even when the stream ends early.

### Read-only review

```bash
ax-code run --sandbox read-only --model qwen -- "Review this diff for bugs"
```

### Structured JSON output with a schema

```bash
cat > answer.schema.json <<'JSON'
{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}
JSON
ax-code run --model qwen --output-schema answer.schema.json --output-file answer.json \
  -- "Return JSON with a one-sentence summary"
```

### Resume a session

```bash
# Start a session and note the sessionID from the result line
ax-code run --format json --model qwen -- "Draft the outline" | tail -n 1

# Continue it
ax-code run --model qwen --session ses_... -- "Now write section 2"
```

### Attach a file

```bash
ax-code run --model qwen --file docs/spec.md -- "Summarize the attached spec"
```
