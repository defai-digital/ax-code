# Protocol Steps: isolation

- Slug: `isolation`
- Reviewer: `codex-sol`
- Independent verifier: `ax-code-glm`
- Date: `2026-08-11`

## Step 1 Scope and map

The `isolation` unit has two implementation files. `packages/ax-code/src/isolation/index.ts:9-60` defines the policy namespace, modes, state, protected defaults, network-command set, and denial type; `packages/ax-code/src/isolation/index.ts:125-290` exposes resolution and enforcement functions. `packages/ax-code/src/isolation/os-sandbox.ts:26-59` defines the OS backend contract, and lines 61-331 implement backend selection, availability probing, canonicalization, Seatbelt policy generation, bubblewrap argument generation, wrapping, and cleanup. The principal production integration is `packages/ax-code/src/tool/bash-impl.ts:656-683`, with mutation and network tools also calling the assertions identified in the source inventory.

## Step 2 Threat and failure model

The protected assets are host files outside the workspace, repository control data under `.git` and `.ax-code`, and network access. Literal/canonical path disagreement, symlink traversal, case variants on macOS/Windows, a bypass applied too broadly, and shell syntax that evades static parsing are the main application-layer threats (`packages/ax-code/src/isolation/index.ts:62-105`, `packages/ax-code/src/isolation/index.ts:168-207`). For bash, an untrusted command and environment cross into Seatbelt or bubblewrap through `packages/ax-code/src/isolation/os-sandbox.ts:238-320`; explicit `os` failure is rejected by `packages/ax-code/src/tool/bash-impl.ts:674-679`, while `auto` may deliberately fall back to app checks at lines 681-683. Reads are intentionally unrestricted under the documented contract (`docs/guides/sandbox.md:24-37`), so this is a write/network boundary rather than a confidentiality sandbox.

## Step 3 Correctness and invariants

Resolution observes environment-over-config precedence and forces network on only for `full-access` (`packages/ax-code/src/isolation/index.ts:125-145`). Write checks compare both lexical and closest-existing canonical forms, require every target representation to remain under an allowed root, fold case for protected paths on case-insensitive platforms, and place the read-only decision before bypass evaluation (`packages/ax-code/src/isolation/index.ts:62-105`, `packages/ax-code/src/isolation/index.ts:193-207`). A bypass is matched per path and is rechecked against protected paths (`packages/ax-code/src/isolation/index.ts:168-190`). Bash first rejects an out-of-bound cwd, then protected targets and external targets (`packages/ax-code/src/isolation/index.ts:254-289`); the caller performs those checks before constructing an OS wrapper (`packages/ax-code/src/tool/bash-impl.ts:656-665`). `Filesystem.contains` normalizes dot segments but explicitly leaves symlink resolution to callers, matching the dual-form strategy (`packages/ax-code/src/util/filesystem.ts:203-212`).

## Step 4 Performance and resource use

Enforcement is synchronous and bounded by the number of parsed paths and protected entries. `securityPaths` can invoke `realpathSync` while walking a missing suffix (`packages/ax-code/src/isolation/index.ts:66-85`), but command path sets and protected lists are normally small. Linux capability probing is the expensive branch: bubblewrap is executed once per resolved binary and cached in `bwrapProbeResults` (`packages/ax-code/src/isolation/os-sandbox.ts:27`, `packages/ax-code/src/isolation/os-sandbox.ts:92-103`). Binary lookup still uses synchronous `which` calls at lines 120-125 and during wrapping at lines 264 and 277; this adds process-start overhead per bash invocation but does not create unbounded work. Seatbelt profiles are mode `0600` and are removed on process close/error by `packages/ax-code/src/isolation/os-sandbox.ts:251-273` and `packages/ax-code/src/tool/bash-impl.ts:779-791`.

## Step 5 Design and boundary ownership

The split is cohesive: `index.ts` owns portable policy decisions and typed denials, while `os-sandbox.ts` only renders and applies platform mechanisms. The bash integration deliberately layers application assertions before kernel wrapping (`packages/ax-code/src/tool/bash-impl.ts:656-683`), allowing unsupported platforms to retain the documented baseline. Backend input is constrained to `app`, `os`, or `auto` by `packages/ax-code/src/config/schema-impl.ts:141-174`. One documentation-hygiene discrepancy remains there: comments and the description at lines 166-170 call `app` the default, while `packages/ax-code/src/isolation/index.ts:59-60`, `packages/ax-code/src/isolation/os-sandbox.ts:61-68`, and `docs/guides/sandbox.md:135-145` make `auto` the actual default. It does not alter runtime enforcement, but should be corrected when schema copy is next touched.

## Step 6 Dead code and hygiene

No TODO, FIXME, or HACK marker appears in either implementation file. The catches in canonicalization intentionally fall back from full realpath to an existing-prefix walk and finally to the resolved lexical path (`packages/ax-code/src/isolation/os-sandbox.ts:132-157`); a Seatbelt-profile write failure is logged and converted into an inactive wrapper (`packages/ax-code/src/isolation/os-sandbox.ts:251-263`). `cleanupProfile` suppresses unlink errors by design because the child has already exited and cleanup is best-effort (`packages/ax-code/src/isolation/os-sandbox.ts:323-330`). The exported `canWrite` predicate feeds `assertWrite` at `packages/ax-code/src/isolation/index.ts:193-220`, and the OS helpers are either used by `wrapCommand`/the bash caller or directly exercised by focused tests, so no removable enforcement branch was identified.

## Step 7 Test adequacy

`packages/ax-code/test/isolation/isolation.test.ts:21-335` covers defaults, environment precedence, protected paths, case variants, symlink escape, network denials, bash cwd/target checks, scoped bypass, empty worktree handling, and the read-only floor. `packages/ax-code/test/isolation/os-sandbox.test.ts:20-142` checks backend resolution, Seatbelt rules, wrapper creation, and the absence of Mach/IPC wildcards. The macOS integration exercises actual workspace/temp writes and denial of an outside write (`packages/ax-code/test/isolation/os-sandbox-integration.test.ts:22-107`). The clearest remaining gap is Linux: bubblewrap construction at `packages/ax-code/src/isolation/os-sandbox.ts:276-320` has neither a deterministic argv unit test nor a live integration test for protected-path remounting and `--unshare-net`.

## Step 8 Finding disposition

`docs/module-quality-audit/modules/isolation/findings/AUDIT-isolation-001.md:1-18` records one Critical finding, now `verified-fixed`: unrestricted Seatbelt `mach*` and `ipc*` grants. The current deny-default profile grants only the enumerated process, sysctl-read, signal, system-socket, file, and conditional network operations (`packages/ax-code/src/isolation/os-sandbox.ts:190-203`), while the regression at `packages/ax-code/test/isolation/os-sandbox.test.ts:31-47` rejects either wildcard. Commit evidence named at finding line 17 matches the two-line removal. No additional security or correctness violation was accepted in this pass; the schema wording drift and absent Linux integration are non-blocking documentation/test observations. The Critical item received the separate secondary confirmation in `docs/module-quality-audit/modules/isolation/protocol/reverify.md`.

## Step 9 Verification and exit

I ran `env AX_TEST_FILES=test/isolation/isolation.test.ts,test/isolation/os-sandbox.test.ts,test/isolation/os-sandbox-integration.test.ts pnpm exec vitest run` from `packages/ax-code`: 3 files and 48 tests passed. The first restricted attempt could not create the integration fixture under the system home; repeating with the required filesystem authority exercised real `sandbox-exec` and passed. I also ran `pnpm --dir packages/ax-code run typecheck`, which completed successfully. A repository search found `mach*`/`ipc*` wildcard text only in the finding and negative assertions, not in `packages/ax-code/src/isolation/os-sandbox.ts`; the `isolation` review therefore exits with its sole Critical item confirmed fixed and the Linux coverage gap documented.
