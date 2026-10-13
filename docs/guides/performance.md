# Performance configuration and diagnostics

Status: Active

Scope: current-state

Last reviewed: 2026-10-13

Owner: ax-code runtime

## Choose a tool profile

For coding sessions that do not need infrastructure operations, scheduling, image generation, or specialized analysis,
set `toolProfile` to `coding` for the connected provider in your AX Code configuration:

```json
{
  "provider": {
    "your-provider-id": {
      "options": {
        "toolProfile": "coding"
      }
    }
  }
}
```

Replace `your-provider-id` with the connected provider ID. This keeps file inspection and editing, shell and background
work, delegation, notebooks, goals, skills, memory, and review verification. Web tools and optional tools still follow
their existing enablement and permission rules. Custom and MCP tools keep their existing admission rules and can add
to the request size.

Use `full` when you need council/arena, operations, scheduling, image generation, or specialized analysis tools. Cloud
providers default to `full`; AX Engine keeps its smaller `core` default. `coding` does not change reasoning effort,
permissions, snapshot capture, or verification requirements. Its effect on speed and task success depends on the model
and workload. See [Model Effort](effort.md) for explicit reasoning controls.

## Separate local preparation from provider response time

Enable local profiling for a run:

```sh
AX_CODE_PROFILE_NATIVE=1 ax-code run --model your-provider-id/your-model "Your task"
ax-code session replay YOUR_SESSION_ID --mode export
```

The exit profile on stderr includes `session.insertReminders`, `session.preparePromptRequest`, `session.preflight`,
`session.resolveTools`, and snapshot `track`/`patch` spans. These are aggregate measurements; nested or overlapping spans
must not be added together as task wall time. Profiling itself adds measurement overhead.

Recorded `llm.response` events gain an optional `timing` object:

| Field            | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `boundary`       | `provider-adapter`: observed at the model adapter, before SDK tool-result handling                        |
| `attempt`        | Adapter attempt number within this `LLM.stream` call; the other fields describe this attempt              |
| `setupMs`        | Time from entry to `LLM.stream` to this adapter dispatch; on retry includes previous attempts and backoff |
| `firstContentMs` | Dispatch to the first nonempty text, reasoning, or tool-input delta, or complete tool call                |
| `firstTextMs`    | Dispatch to the first nonempty text delta; absent for a tool-only or reasoning-only response              |
| `streamMs`       | Dispatch to the adapter's finish frame; absent when no finish frame was observed                          |

Metadata and stream-start frames do not count as content. Times use a monotonic clock and reflect when chunks are
observed, including any stream backpressure. They are not raw network timings, server inference timings, or TUI render
timings. CLI adapters can include the child CLI's own work. The existing `latencyMs` retains its older mixed step timing
and can include tool execution and snapshot work. New timing fields contain durations and attempt identity only.

Without `AX_CODE_PROFILE_NATIVE=1`, the additional timing object is omitted. Profiling uses local diagnostics and the
existing session event log; it does not enable an external telemetry exporter.

For a useful comparison, hold the task, repository revision, provider endpoint, exact model, reasoning effort, tool
permissions, and cache conditions constant. Record first visible response time and time to a verified result, including
tests and repair attempts. A smaller request or faster local snapshot alone does not establish faster cloud task completion.

Use [harness controls and verified evaluation](harness-controls.md) to try context recovery, MCP discovery, read-only
recipes, and matched fixture comparisons with independent verification.

## Understand request size

New `llm.request` events in `ax-code session replay YOUR_SESSION_ID --mode export` include `requestBytes` when request provenance is available:

| Field             | Meaning                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- |
| `encoding`        | `canonical-json-utf8`: byte length of the existing canonical fingerprint representation |
| `system`          | The separately assembled system-message array                                           |
| `messages`        | The complete assembled message array, including system messages                         |
| `toolDefinitions` | Active tool names, descriptions and resolved input schemas                              |

`system` is already represented within `messages`; do not add them together. To estimate the prompt you send before history grows, add `system` and `toolDefinitions` (for example, `system` 160 KB plus `toolDefinitions` 82 KB is about 242 KB, not 402 KB); add `messages` only to compare history growth between turns, and subtract `system` from it when you want the non-system part. Array framing is included. Binary values use the existing digest representation, so these sizes are neither network payload sizes nor resident-memory measurements. They are not token counts: provider token usage and cache counters remain the source for model input accounting. A context-pack summary covers a narrower stage and is not total model input. Legacy events omit this field; failed provenance remains explicitly unavailable.

Only sizes and the existing hashes/metadata are recorded by this diagnostic. No additional prompt bodies or credentials are saved. It reuses the canonical serialization needed for each hash rather than tokenizing the request. Compare sizes at matching turns when deciding whether system instructions, tool definitions, or growing history need attention. The coding profile above can reduce tool definitions without changing reasoning effort; full remains available for the capabilities it adds.

## Fit a small context window

A model with a small context window can reject the first request when the fixed prompt is too large. The fixed prompt is the system instructions, project and global memory, `AGENTS.md`, the skill catalog, and tool definitions. Two behaviors keep this recoverable:

- **Memory budget.** Injected memory (`.ax-code/memory.json` and `~/.ax-code/memory.json`) is limited to 10% of the model's context window, with a floor of 2,000 tokens. Global entries use at most half of that budget, and unused budget carries over to project entries and then to scanned sections such as the directory structure. Whole entries are dropped rather than cut, ordered by confidence and recency within each section; a scanned section is truncated at a line boundary. When anything is left out, the memory block ends with a note giving the number of omitted items. If the model does not report a context window, memory is not limited.
- **No empty compaction.** When a request overflows the context window and there is no earlier conversation to summarize, for example on the first message of a session, AX Code stops with an explanatory error instead of scheduling a compaction that cannot shrink the request. Compaction summarizes the history before the latest user message, so it helps only when such history exists.

If you still hit the error, reduce what is injected: trim entries with `ax-code memory list`, shorten `AGENTS.md`, use the coding tool profile above, or choose a model with a larger window. Compare `requestBytes.system` and `requestBytes.toolDefinitions` in a replay export to see which part dominates.

## Avoid redundant exploration

For a known-file lookup or simple count, use a focused search or one aggregate command. Resolve paths against the current workspace directory; a session started inside a package already has that package as its search root. Built-in grep uses ripgrep's default regex syntax without lookaround or backreferences.

Use one investigator for one call path. Parallel read-only tasks should have distinct deliverables and owned paths or subsystems, with existing evidence supplied in their briefs. Independent review can revisit evidence for a separate verification question. Repeating discovery in multiple fresh contexts costs model rounds even when the evidence cache hits; cache hits do not bypass current-content validation or permissions.

Language servers now start on demand by default. See [Memory usage](memory-usage.md) for speculative prewarming opt-in and the tradeoff with first semantic-query latency. Prompt guidance and local tests do not establish a particular reduction in live model calls or physical RAM.
