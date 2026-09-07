# Performance configuration and diagnostics

Status: Active

Scope: current-state

Last reviewed: 2026-09-06

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
ax-code replay YOUR_SESSION_ID --mode export
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
