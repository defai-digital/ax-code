# Review Protocol: tool-execution

## Step 1 Surface and Boundary Map

The `tool-execution` unit exposes the foreground/background shell entry point through `packages/ax-code/src/tool/bash.ts:1`, the incremental reader through `packages/ax-code/src/tool/bash_output.ts:11-86`, and termination through `packages/ax-code/src/tool/kill_shell.ts:6-33`. `packages/ax-code/src/tool/bash-impl.ts:209-249` owns the command schema and runtime initialization, while `packages/ax-code/src/tool/bash-background.ts:18-341`, `bash-destructive.ts:142-177`, and `bash-helpers.ts:3-127` isolate registry, classification, and parsing helpers. The audit inventory and its single finding were also read at `docs/module-quality-audit/modules/tool-execution/MODULE-AUDIT.md:20-97` and `docs/module-quality-audit/modules/tool-execution/findings/AUDIT-tool-execution-001.md:1-31`.

## Step 2 Threat and Failure Model

The main hostile inputs are command text, working directory, shell-expanded paths, redirected paths, process output, and shell IDs supplied across sessions. Workdirs are resolved and checked for project-contained symlinks before spawning (`packages/ax-code/src/tool/bash-impl.ts:251-302`); dynamic redirects are rejected at `bash-impl.ts:254-255`, and parsed output paths are added to isolation and blast-radius checks at `bash-impl.ts:576-609`. Background lookups enforce the caller's session at `packages/ax-code/src/tool/bash-background.ts:243-247`, `297-300`, and `311-315`, limiting cross-session observation and termination.

## Step 3 Execution Correctness

Tree-sitter command nodes feed path collection, destructive classification, and permission patterns (`packages/ax-code/src/tool/bash-impl.ts:455-574`), with a raw-command permission fallback when no command is found (`bash-impl.ts:700-708`). Spawn selection preserves cwd, sanitized environment, pipes, and process-group behavior across OS-sandbox, Linux/Bun setsid, and normal shell branches (`bash-impl.ts:748-790`). Foreground completion snapshots the exit code on `exit`, drains inherited pipes, resolves on `close`, and unregisters listeners/PIDs (`bash-impl.ts:956-1000`); the background registry similarly decodes split UTF-8, finalizes once, and destroys inherited pipes after exit (`packages/ax-code/src/tool/bash-background.ts:160-202`, `208-228`).

## Step 4 Security Controls

The Critical tilde-path fix is present: `expandLeadingTilde` expands only `~` and `~/...` and rejects `~user` forms (`packages/ax-code/src/tool/bash-helpers.ts:17-23`), and both ordinary path recording and redirect recording use it before containment checks (`packages/ax-code/src/tool/bash-impl.ts:333-353`, `590-600`). Opaque dynamic paths require an interactive external-directory request at `bash-impl.ts:644-654`; destructive commands receive a separate `bash_destructive` request with no persistent approvals at `bash-impl.ts:710-723`. The enforcement layer lists that permission as interactive-only and refuses wildcard/autonomous bypass (`packages/ax-code/src/permission/index.ts:201-210`, `314-334`). Child environments are sanitized immediately before all spawn branches (`bash-impl.ts:735-778`).

## Step 5 Resource and Process Resilience

Foreground PIDs are tracked and reaped on parent exit, with TERM-to-KILL escalation timers (`packages/ax-code/src/tool/bash-impl.ts:114-183`), while command timeout and abort share an idempotent kill path (`bash-impl.ts:928-999`). Foreground output stops accumulating after 10 MiB and metadata publication stops repeating byte-identical capped snapshots (`bash-impl.ts:843-923`). Background execution limits each session to 16 active shells, retains at most 16 finished unread shells, caps unread output at 2 MiB, and bounds observer replay at 256 KiB (`packages/ax-code/src/tool/bash-background.ts:27-37`, `68-87`, `123-148`). These limits cover indefinite servers and noisy commands without losing the explicit dropped-output signal returned by `bash_output` at `packages/ax-code/src/tool/bash_output.ts:71-83`.

## Step 6 Design and Ownership

The split is coherent: `bash-impl.ts` coordinates parsing, policy, isolation, spawning, and result metadata; `bash-background.ts` owns durable in-process shell state; `bash-destructive.ts` is a deterministic argv classifier; and `bash-helpers.ts` contains side-effect-light parsing/UTF-8 utilities. `bash_output.ts` consumes the registry cursor without process authority, while `kill_shell.ts:15-21` asks for bash permission before delegating termination. The one-line `bash.ts` re-export keeps the import surface stable. The classifier documents its wrapper flag-value limitation at `packages/ax-code/src/tool/bash-destructive.ts:22-27`, making the normal bash permission the stated fallback rather than concealing classifier reach.

## Step 7 Hygiene and Error Disposition

No empty catch in the seven candidate sources hides a state mutation. Best-effort asynchronous boundaries log observer, toast, metadata, and kill failures (`packages/ax-code/src/tool/bash-background.ts:149-157`, `187-196`; `packages/ax-code/src/tool/bash-impl.ts:876-890`, `935-953`). The URL parser catch at `bash-impl.ts:82-89` maps invalid input to a false predicate, and filesystem catches either distinguish missing paths or throw a specific workdir error (`bash-impl.ts:105-111`, `296-301`). The remaining TODO at `bash-impl.ts:208` concerns the tool's cross-shell name, not incomplete execution behavior; no candidate export was found to be orphaned from the public tool flow or focused tests.

## Step 8 Test Coverage Review

`packages/ax-code/test/tool/bash-helpers.test.ts:17-127` covers dynamic expansions, current-user tilde expansion, `~user` rejection, path selection, and UTF-8 boundaries. `packages/ax-code/test/tool/bash-destructive.test.ts:4-72` exercises destructive and benign argv variants, and `packages/ax-code/test/tool/bash-background.test.ts:40-258` covers completion, kill, session scoping, incremental reads, filtering, capacity, decoding, eviction, and buffer truncation. Integration checks in `packages/ax-code/test/tool/bash.test.ts:157-403` validate permission patterns and external paths, while `bash.test.ts:699-914` covers redirect, nested shell/eval, dynamic-target, and traversal isolation. A direct end-to-end `~/...` permission assertion would strengthen the pure helper regression, but the helper and both production call sites were independently inspected.

## Step 9 Findings and Verification

`AUDIT-tool-execution-001` is Critical and marked verified-fixed at `docs/module-quality-audit/modules/tool-execution/findings/AUDIT-tool-execution-001.md:5-14`; the source/test evidence above supports that disposition, and `protocol/reverify.md` records the required second confirmation. The three directly focused files passed 35/35 tests. The initial four-file run passed 90/92 but two OS-isolation allow-path cases returned exit 71 under the nested sandbox; rerunning the same four files with `AX_CODE_ISOLATION_BACKEND=app` passed 92/92. `pnpm --dir packages/ax-code run typecheck` also passed. No source change or additional finding artifact was needed for this protocol review.
