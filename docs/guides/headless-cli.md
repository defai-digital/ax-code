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
promptly and close stdin — or use `--prompt-file` for large or slowly produced prompts. `--prompt-file -` reads the
prompt from stdin explicitly (usage error when stdin is a TTY); the implicit piped-stdin append never runs a second
time for that invocation.

`-f/--file` attaches files to the message and never replaces the prompt; it is repeatable:

```bash
ax-code run --model qwen --file README.md --file src/main.ts -- "Summarize these"
```

An attachment must live inside the project directory: the server refuses attachments outside it regardless of
permission rules, so the CLI rejects them up front with a usage error. Copy the file into the project or pass its content
with `--prompt-file`. `--add-dir` grants tools access to extra directories but does not change this rule.

Attachment mime types are inferred from the extension: `png`, `jpg`, `jpeg`, `gif`, and `webp` map to their `image/*`
type and `pdf` to `application/pdf`, so binary attachments reach the server as their real type instead of `text/plain`.
Anything else — including a file with no recognized extension — is sent as `text/plain`, and a directory attachment is
classified `application/x-directory`.

## Steering the run

Three flags steer a run without changing the prompt text. All are long-only and kebab-case.

### `--append-system-prompt TEXT` / `--append-system-prompt-file PATH`

Appends extra text to the system prompt after the agent and environment system prompts — **it appends and never
replaces the built-in system prompt**. The two forms are mutually exclusive. A file variant is convenient for longer
instructions; exactly one trailing newline is trimmed, and an empty text (or unreadable file) is a usage error before
anything is submitted.

```bash
ax-code run --model qwen --append-system-prompt "Answer in English only" -- "Review this change"
```

### `--disallowed-tools a,b`

Disables tools by id for the run (comma-separated, repeatable). It is applied through both server mechanisms: deny
rules on the created session cover new runs, and a per-request tools map also covers resumed `--session`/`--continue`
runs. Unknown ids are not an error — MCP tool ids are dynamic — but under the default format each id outside the
built-in tool set prints one stderr warning (suppressed by `--quiet`).

```bash
ax-code run --model qwen --disallowed-tools bash,write -- "Audit this module without mutating anything"
```

### `--add-dir PATH`

Grants the agent access to one additional directory (repeatable): an `external_directory` allow rule for
`<resolved-path>/*` is added to the new session's permission rules, covering the directory and everything beneath it.
Each path must exist and be a directory (resolved against the caller cwd like `--file`). The rule is applied when the
session is created, so under `--session`/`--continue` it cannot take effect — the CLI prints
`--add-dir applies only to new sessions` on stderr and continues. It does not change `--file` containment: attachments
must still live inside the project directory.

```bash
ax-code run --model qwen --add-dir ../design-docs -- "Read ../design-docs/spec.md and summarize it"
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
stderr, starting with a `> Agent · model · ses_...` header that includes the session id, so a multi-turn caller can
resume with `--session` without switching to `--format json` (`--quiet` suppresses the header). ANSI colors are
disabled when stderr is not a TTY or when `NO_COLOR` is set (any value), so a piped run never emits escape codes.

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

The `error.code` is one of:

| Code       | When it fires                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `usage`    | Bad or contradictory flags, a missing prompt, or an unreadable `--output-schema`.                                               |
| `provider` | Unknown provider id, or a known provider that is not connected.                                                                 |
| `model`    | Unknown model id on a known provider, or an unparseable `--model` value.                                                        |
| `session`  | A missing or rejected `--session` id (preflighted before the run submits).                                                      |
| `attach`   | The attached server could not be reached, rejected the credentials (401/403), or no managed runtime is running for `--runtime`. |
| `internal` | Any otherwise-unhandled rejection.                                                                                              |

## Exit codes

| Code | Meaning                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | Completed.                                                                                                    |
| 1    | Usage error, provider/model error, stream error, or `--output-schema` validation failure.                     |
| 3    | Blocked — at least one permission denial and no successful mutating tool call (`result.status` is `blocked`). |
| 124  | Timed out (`--timeout` elapsed; `result.status` is `timeout`).                                                |
| 130  | Cancelled by SIGINT or SIGTERM (session aborted on the server; `result.status` is `cancelled`).               |

## Sandbox

`--sandbox read-only|workspace-write|full-access` selects the isolation mode (default `full-access`). In headless runs
permission asks are auto-rejected and reported as `permission_denied` events, so a run that needs a write it was not
allowed to make reports `blocked` and exits 3. Use `read-only` only when no mutation is expected; `workspace-write`
keeps writes inside the project.

Under `--attach` the flag is also sent as a per-request isolation policy in every prompt body; the server applies the
stricter of its own mode and the requested policy, so it can only tighten. The same per-request policy is sent for
locally owned servers, keeping the behavior uniform.

## Structured output

`-o/--output-file <path>` writes the final assistant text to a file. `--output-schema <file>` validates the final text
as JSON against a JSON Schema file and exits 1 on mismatch. The schema file is preflighted before the model runs — an
unreadable, unparseable, or non-object schema is a usage error before anything is submitted. On success the parsed
schema is also sent to the model as the run's `json_schema` output format, and the server retries an invalid reply up
to twice before the CLI's own final validation runs as the backstop. The final output is the serialized structured
object (one line of JSON): it is what stdout, `--output-file`, and `result.text` carry:

```bash
ax-code run --model qwen --output-schema ./answer.schema.json -- "Return a JSON object with a summary field"
```

## Sessions and resuming

- `-c/--continue` — continue the most recent session.
- `-s/--session <id>` — continue a specific session by ID.
- `--fork` — fork the session before continuing (requires `--continue` or `--session`).
- `--show-history` — print visible session history when resuming (requires `--continue` or `--session`).
- `--attach <url>` — attach to an already-running server instead of starting one; combine with `--dir` to target a
  project directory on that server. A server protected with `AX_CODE_SERVER_PASSWORD` takes `--password` (or the same
  variable on the caller side); a managed runtime takes its token from `AX_CODE_RUNTIME_TOKEN`.
- `--runtime` — attach to the managed runtime of the project directory (`--dir` or the caller cwd) started with
  `ax-code runtime start`, resolving its URL and token from the private runtime record. With no running runtime the
  run fails before any request with error code `attach` and a message that names the start command. `--runtime` and
  `--attach` are mutually exclusive.

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
the bound, so a stuck agent cannot hold a CI job open indefinitely. The bound covers the whole invocation — it is
armed before the first server call, so even a black-holed `--attach` host or a hung startup terminates on time (in
that early case the result line carries an empty `sessionID`).

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

## Machine-readable commands

`ax-code run --format json` emits a newline-delimited event stream (see [JSON stream](#json-stream--format-json)); it is
the only `--json` surface that streams. Every other read-only command that carries a `--json` flag follows a stricter
contract: on success it writes exactly one JSON document to stdout, and on failure stdout stays empty while a single
`{"error":{"code","message"}}` document goes to stderr and the exit code is 1.

Commands with `--json`:

- `ax-code session list --json`
- `ax-code models --json`
- `ax-code providers list --json`
- `ax-code agent list --json`
- `ax-code mcp list --json`
- `ax-code mcp auth list --json`
- `ax-code stats --json`
- `ax-code context --json`
- `ax-code memory status --json`
- `ax-code memory list --json`
- `ax-code task list --json` / `ax-code task show <taskID> --json`
- `ax-code schedule list --json` / `ax-code schedule show <taskID> --json`
- `ax-code runtime list --json` / `ax-code runtime status --json`
- `ax-code doctor --json`
- `ax-code risk <sessionID> --json`
- `ax-code wiki status --json`
- `ax-code workflow list --json` / `ax-code workflow status <runID> --json`

`ax-code runtime status` prints its JSON document unconditionally — the `--json` flag is accepted for consistency but
the status action always emits JSON on stdout.

## Calling ax-code from another agent

When wrapping `ax-code run` from a script, CI step, or another agent:

- Use `--format json` and read the **last** line — the `result` record is always the final line, even when the stream
  ends early.
- Capture `sessionID` from that result line for any follow-up turn; pass it back with `--session`.
- Never use `--continue` from concurrent callers — it resumes the most recent session, which races when multiple
  callers are active; pass an explicit `--session` id instead.
- Pass an explicit `--model` so the run does not depend on a mutable configured default.
- Always pass `--timeout` so a stuck agent cannot hold the caller open.
- Close stdin, or use `--prompt-file` / `--prompt-file -`: the implicit pipe reader gives up after a 300 ms quiet
  window and truncates a slow pipe silently.
- Set `NO_COLOR=1`, or rely on the non-TTY detection, so a piped run never emits ANSI escape codes.
- Run from the project directory: a home or multi-repo parent directory is refused in non-interactive mode. Set
  `AX_CODE_ALLOW_BROAD_DIR=1` to override that guard.
- Usage failures print nothing on stdout (help and the one-line error go to stderr), so a mistyped command leaves
  stdout empty with exit 1.
