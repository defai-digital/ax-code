# Memory usage

Status: Current

Scope: current-state

Last reviewed: 2026-09-13

Owner: ax-code runtime

AX Code shares the machine with language servers, repository builds, browsers and any local model runtime. A TypeScript server or Rust analyzer can use more memory than the AX Code backend itself. Those processes provide code analysis; they are not voice services. Summing process RSS can count shared pages more than once.

## Profiles

`AX_CODE_MEMORY_PROFILE` accepts `auto` (default), `low`, or `normal`. In `auto`, a host reporting at most 8 GiB of physical RAM selects `low`; other hosts select `normal`. Invalid values use automatic detection. Detection uses physical host RAM, not free RAM or a container memory limit; select `low` explicitly in a constrained VM/container when necessary. Set the variable before starting AX Code; it does not reconfigure an already-running backend.

```bash
AX_CODE_MEMORY_PROFILE=low ax-code
```

PowerShell:

```powershell
$env:AX_CODE_MEMORY_PROFILE = "low"
ax-code
```

| Behavior                                      | Normal                             | Low                                                                               |
| --------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| Speculative language-server bootstrap prewarm | Enabled                            | Skipped; analysis starts on demand                                                |
| Previous-source-text cache per LSP client     | 16 MiB retained-content accounting | 4 MiB retained-content accounting                                                 |
| Concurrent LSP initialization                 | Existing server scheduling         | One initialization at a time per backend process                                  |
| Concurrent semantic operations                | Existing server budgets            | Two awaited semantic operations per backend process, plus existing server budgets |
| Healthy idle language servers                 | Existing lifecycle                 | Eligible for shutdown after five idle minutes, checked about once per minute      |

The source cache also has a 1,000-entry limit. Its accounting includes a conservative string/key allowance; it is not a V8 heap or RSS limit. A file that cannot fit still synchronizes its full current contents with the language server. Cache eviction does not close a document while a request may need it.

Low mode queues work rather than skipping analysis. First use or use after an idle shutdown can take longer. Selected/queued clients, pending underlying RPCs and diagnostic waits are protected from idle shutdown. A timed-out request can leave server-side work running: two awaited operations do not guarantee only two computations inside language servers. Diagnostic inventory is marked degraded after idle reclamation because restarting one file cannot prove complete coverage of the former workspace.

These limits apply within each AX Code process. They do not limit total RAM, coordinate separate AX Code instances, cap language-server heaps, or control a compiler/browser/local model. Model selection, required prompt context and verification commands remain unchanged.

## Session and evidence retention

The TUI keeps heavy transcript events for the viewed session. Inactive sessions retain summaries, status and pending approvals/questions; opening them reloads saved history from SQLite. The normal display window is 100 messages with a 16 MiB serialized-payload budget. Old complete messages are released first. The newest indivisible message and recovered Undo/Restore history can exceed the soft budget; the TUI displays an indicator. These are projection limits, not limits on durable session history or model context.

Parts arriving before their parent message use a bounded pending area (128 message IDs / 1 MiB). If pending content must be released, the TUI offers a reload from saved history. Late events for evicted messages cannot permanently recreate orphan parts.

The evidence cache defaults to bounded memory (128 entries / 4 MiB serialized values per instance). RocksDB remains opt-in; changing the cache backend alone does not reduce model tool calls. See [Evidence cache](evidence-cache.md).

## Background command output

Unread background output uses private transient files instead of retaining multi-megabyte JavaScript strings for every finished shell. Each file is a 2 MiB UTF-8 ring; oldest unread output beyond that limit is dropped and labeled. Up to 32 ring files reserve at most 64 MiB per process. When disk slots are full, the oldest finished spool can expire; active shell ownership is not evicted. Reads return the retained unread output incrementally and release its disk slot.

The registry allows 16 active shells per session and 32 per process, and retains at most 16 finished records per session / 64 per process. Finished output expires after 30 minutes (checked on access and about once per minute). Command/description listings are previews capped at 8 KiB / 1 KiB; the executed command is unchanged. Observer replay has separate limits of 64 KiB and 128 records per shell, with a 2 MiB process-wide byte budget; incomplete replay is labeled.

`bash_output` reports output integrity separately from the real process exit status. Dropped, expired or unreadable output is incomplete verification evidence even when the command exited with code zero. These notices remain visible when an output filter is used. A missing record can mean it was already consumed or evicted; unavailable output is not proof that a check passed.

Files use a private process-owned temporary directory (0700) and 0600 files on POSIX. Reads, session removal, retention cleanup and normal process exit release owned files. The spool is not crash-durable session storage. Forced termination or a crash can leave a private temporary directory behind; automatic cross-process scavenging is not implemented, so the 64 MiB limit describes the current process, not accumulated crash leftovers. Filesystem cleanup errors are reported and do not free the failed file's quota reservation. Synchronous bounded file I/O avoids unbounded write queues but can add latency on a slow temporary filesystem.

## Choosing a workload

For constrained hosts, use a cloud provider, one active coding session and a small repository first. Run large builds and additional agent sessions only when the machine has headroom. Local inference needs a separate budget for weights, KV cache/context and runtime overhead; cloud-provider hardware guidance does not apply to it.

Use the packaged CLI for ordinary use; `pnpm run dev` is a contributor source workflow with a different startup/module-loading cost. Inspect AX Code together with its language-server and build children in Activity Monitor or the platform process monitor. A reduced cache bound does not establish a fixed reduction in physical memory.

The memory changes have deterministic retention and semantic-equivalence tests. They have not been qualified by a load test on a physical 8 GB Mac. Low mode is not a guarantee that an arbitrary project will fit on an 8 GB machine.
