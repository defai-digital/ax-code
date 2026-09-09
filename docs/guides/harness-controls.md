# Harness controls and verified evaluation

Status: Active

Scope: current-state

Last reviewed: 2026-09-07

Owner: ax-code runtime

## Optional context and tool controls

Enable each experiment independently in your AX Code configuration:

```json
{
  "experimental": {
    "context_recovery": true,
    "mcp_tool_discovery": true,
    "tail_reminders": true,
    "read_only_recipes": true
  }
}
```

All four options default to off. Measure task success and elapsed time with your model before adopting them together.
They retain existing tool permissions and isolation settings. See [performance diagnostics](performance.md).

`context_recovery` exposes `context_recover` and adds source pointers to successful compaction summaries. The tool
accepts a keyword, message ID, optional part ID, and a result limit. It only reads the current session, including
pre-compaction history, and excludes reverted material, hidden reasoning, and ignored or synthetic text. It returns
original message/part IDs and bounded excerpts. Search scans at most 100 parts per page and the first 16,000 characters
of each part; `before` continues into older parts. A missing match is not proof that the entire history lacks that text.
Forks use their copied history and new IDs. Credential assignments are redacted from excerpts.

`mcp_tool_discovery` keeps built-in tools available and introduces `tool_search` for connected MCP tools. A search
returns up to five matching schemas and makes those tools available on the next model request. It does not execute
them. Selections are scoped to the session, bounded to 32 tools, and intersected with current admission on each request.
Large schemas may be omitted from the search result and loaded on the next request. If `tool_search` is denied,
the ordinary admitted MCP catalog remains available. A conflicting existing tool named `tool_search` produces an error.

`tail_reminders` moves only AX Code's generated dynamic turn reminders to the end of the provider request. Stored user
messages, assistant reasoning, tool history and static instructions remain unchanged. This can change model behavior
and cache use; it does not establish a speed improvement on its own.

`read_only_recipes` exposes `read_recipe`. It runs up to eight dependent `read`, `glob`, or `grep` calls through the
normal tool dispatcher. Each child has its own permission checks, hooks, cancellation and session evidence. A recipe
cannot evaluate code, run shell commands, write files, call MCP tools or nest another recipe.

```json
{
  "steps": [
    { "id": "files", "tool": "glob", "parameters": { "pattern": "src/**/*.ts" } },
    {
      "id": "source",
      "tool": "read",
      "parameters": { "filePath": { "$ref": { "step": "files", "path": ["paths", 0] } } }
    }
  ],
  "select": [{ "step": "source", "path": ["text"] }]
}
```

Canonical glob results contain `paths` and `truncated`; grep results contain `matches` with `path`, `line`, `text`;
read results contain `kind`, rendered `text`, and `truncated`. Select a previous result by its step and own-property
path. Array selections support a literal `contains` filter and `limit`. Check the returned status and truncation.
The recipe has a 60-second cancellation deadline, 32KB argument budget, 192KB intermediate budget and bounded final
output. Cancellation waits for the owned tool to settle. New repository instructions or media pause execution and
retain normal child output so the model sees them before continuing. Successful selections replace intermediate
outputs only in the model request; the original child records remain in history. Interrupted parents keep child output.

## Correct a running generation

`GET /session/{sessionID}/steering` returns the active generation UUID and recent receipts. Include the existing
`directory` query parameter when selecting a project through the HTTP server.

Send `POST /session/{sessionID}/steering` with:

```json
{
  "expectedGeneration": "00000000-0000-4000-8000-000000000001",
  "clientID": "correction_1",
  "text": "Preserve the existing public function signature."
}
```

Use the UUID from GET, not the example UUID. `accepted` means the correction is pending. `applied` means it was
written as a user message at a loop boundary and includes its message ID; it does not guarantee provider completion.
`rejected` means it was not applied. Lifecycle hooks may veto admission. Completion or cancellation rejects pending
corrections, and an old generation cannot admit text to its successor. Identical retries return the same retained
receipt; different content under an existing client ID returns HTTP 409.

Receipts are process-local, with at most 256 per session and 32 pending requests. Terminal receipts and inactive session
entries can be evicted. After a restart, obtain the new generation and reconcile saved messages; this API does not
promise durable receipt lookup across restarts. The generated SDK exposes `session.steering` and `session.steer`.

## Propose a skill from verified work

Skill candidates are explicit records in AX Code's existing local storage. They do not enter skill discovery until
you promote them, and they never trigger an automatic model call or instruction rewrite.

Create a proposal JSON file with `name`, `description`, `applicability`, `procedure`, and `evidence` containing
`sessionID`, `messageID`, and `partID`. Evidence must identify an original successful `verify_project` result with
executed test or type-check envelopes against the current clean Git revision. A success sentence or arbitrary shell
exit is insufficient. Validation must cite another session's successful verification at the same revision.

```sh
ax-code skill candidate propose --file proposal.json
ax-code skill candidate show verified-procedure
ax-code skill candidate validate verified-procedure --file independent-evidence.json
ax-code skill candidate promote verified-procedure
ax-code skill candidate retire verified-procedure
```

Keep input JSON outside the worktree or in an ignored local directory so the clean-revision check remains meaningful.
Promotion creates `.ax-code/skill/{name}/SKILL.md` without overwriting an existing skill. Source evidence is rechecked
before promotion. Symlinked directories are rejected. Retirement removes only the candidate's own unchanged file;
manual edits cause a conflict. Restart an existing runtime instance to refresh its cached skill discovery.
Passing checks establishes evidence for those checks; review the procedure's applicability before promotion.

## Capture a matched experiment

From a source checkout, use:

```sh
pnpm --dir packages/ax-code exec tsx script/harness-eval.ts run /path/to/manifest.json > /path/to/runs.ndjson
pnpm --dir packages/ax-code exec tsx script/harness-eval.ts compare /path/to/runs.ndjson baseline candidate
```

The trusted operator manifest contains an explicit `provider/model`, `runtimeRevision`, optional CLI `command` argv,
`repetitions`, `timeoutMs`, exactly two named `arms`, and `tasks`. Each arm has optional `features` (the experimental
flags above) and `toolProfile`. Each task supplies `id`, `prompt`, inline `files` (`path`/`content`), and an `oracle`.
The oracle is trusted JavaScript executed by Node after the coding process exits; `process.argv[1]` identifies the
temporary fixture. Its code remains outside the agent's workspace and never comes from the model's response.

Each attempt gets a fresh Git fixture. The oracle must fail with exit 1 on the initial fixture. The runner uses a
fixed headless CLI invocation, alternates arm order between repetitions, applies a timeout, and runs the oracle again
after a completed attempt. `elapsedMs` includes the coding process and post-run verification; `verificationMs` identifies
the latter separately. Fixture setup and the initial failing check are excluded. The stream records every completed,
failed, timed-out or cancelled attempt as it finishes. Raw prompts, subprocess output and credentials are not emitted
in evaluation records. An interrupted cohort remains incomplete and cannot produce a matched comparison.

The comparison rejects duplicates and missing or mismatched task/model/cohort/repetition pairs. Failed and unverified
attempts stay in success-rate denominators. Latency medians and paired ratios are explicitly conditioned on verified
success. P95 requires 20 successful observations within a task/model/cohort/arm cell; mixed-cell aggregates omit it.
The cohort hashes the manifest, but runtime revision and external provider/config/cache conditions still require
operator control. A small smoke run cannot establish general speed superiority or justify changing defaults.
