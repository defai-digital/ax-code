# Protocol steps — unit `bun`

## Step 1 Scope and Runtime Surface

The `bun` unit spans the ambient contract, process/install orchestration, the Node compatibility implementation, package-manager selection, and registry queries. The declared runtime surface is concentrated in `packages/ax-code/src/bun/bun-global.d.ts:64-87`; `BunProc` begins at `packages/ax-code/src/bun/index.ts:15`; the Node shim is installed at `packages/ax-code/src/bun/node-compat.ts:319-337`; and package-manager command shapes live at `packages/ax-code/src/bun/package-manager.ts:43-66`. The source inventory in `docs/module-quality-audit/modules/bun/MODULE-AUDIT.md:24-30` agrees with the five candidate source files reviewed.

## Step 2 Trust Boundaries and Process Safety

Dynamic package names can originate in configuration, so `BunProc.install` rejects path traversal and names outside its npm-name grammar before joining a cache path (`packages/ax-code/src/bun/index.ts:108-147`). Package-manager invocations use argument arrays rather than a shell (`packages/ax-code/src/util/process.ts:108-119`), and both install and registry paths pass a sanitized environment (`packages/ax-code/src/bun/index.ts:197-204`, `packages/ax-code/src/bun/registry.ts:19-27`). The Node shell shim deliberately replaces, rather than merges, an explicitly supplied environment to avoid reintroducing stripped credentials (`packages/ax-code/src/bun/node-compat.ts:82-94`). Interpolated shell values are single-quoted with embedded quotes escaped at `packages/ax-code/src/bun/node-compat.ts:138-154`.

## Step 3 Install and Registry Correctness

Executable selection avoids treating a compiled AX Code binary as Bun and prefers a distinct external Bun path (`packages/ax-code/src/bun/index.ts:51-60`). Dynamic installs are serialized, initialize a missing cache manifest, distinguish pinned from `latest`, and update the manifest only after the package-manager call (`packages/ax-code/src/bun/index.ts:150-168`, `packages/ax-code/src/bun/index.ts:197-238`). One low-impact correctness concern remains: `PackageRegistry.isOutdated` converts a failed lookup to `false` (`packages/ax-code/src/bun/registry.ts:40-45`), but the caller records the check timestamp before interpreting that value (`packages/ax-code/src/bun/index.ts:181-184`). A transient outage can therefore suppress another `latest` check for the full 24-hour TTL even though the comment describes caching a successful check (`packages/ax-code/src/bun/index.ts:116-119`). Availability is preserved by using the cached package, so this is not Critical.

## Step 4 Performance and Resource Bounds

The install lock at `packages/ax-code/src/bun/index.ts:150-152` prevents concurrent writers from racing on the shared cache manifest, while the one-day timestamp gate at `packages/ax-code/src/bun/index.ts:116-130` avoids a registry round trip on every session. Registry queries and installs have explicit 10-second and 60-second abort bounds (`packages/ax-code/src/bun/registry.ts:23-28`, `packages/ax-code/src/bun/index.ts:200-221`). The compatibility glob uses an iterative stack but still walks every reachable directory under `cwd` (`packages/ax-code/src/bun/node-compat.ts:180-200`, `packages/ax-code/src/bun/node-compat.ts:204-229`); that matches the minimal shim goal but can be expensive for broad roots. `stringWidth` is linear over ANSI-stripped code points (`packages/ax-code/src/bun/node-compat.ts:279-282`).

## Step 5 Ownership and Runtime Separation

Runtime detection owns the Bun-versus-Node distinction: `node-bundled` and `node-source` are explicit modes in `packages/ax-code/src/installation/runtime-mode.ts:14-14`, and the bun unit maps both to npm in `packages/ax-code/src/bun/package-manager.ts:17-20`. Command construction is centralized in `toolRunner` and `NpmManager` (`packages/ax-code/src/bun/package-manager.ts:43-66`), while registry semantics remain in `PackageRegistry` (`packages/ax-code/src/bun/registry.ts:7-51`). Node entry points install compatibility before dynamically importing either CLI boot path (`packages/ax-code/src/index-node.ts:1-5`, `packages/ax-code/src/index-node-tui.ts:5-9`), so consumers do not need scattered setup calls. The split is cohesive and avoids circular ownership.

## Step 6 Error Handling and Code Hygiene

The silent fallbacks in the shim have narrow compatibility meanings: `Bun.file(...).exists()` maps access failure to `false` (`packages/ax-code/src/bun/node-compat.ts:23-37`), and glob traversal treats an unreadable directory as empty in async and sync forms (`packages/ax-code/src/bun/node-compat.ts:187-188`, `packages/ax-code/src/bun/node-compat.ts:211-216`). Install-manifest parse errors are not swallowed; only `ENOENT` creates a new manifest (`packages/ax-code/src/bun/index.ts:155-161`). Two harmless cleanup candidates are visible: the byte-count conditional repeats `content.byteLength` on both non-string branches (`packages/ax-code/src/bun/node-compat.ts:42-47`), and adjacent doc blocks in `packages/ax-code/src/bun/package-manager.ts:23-42` can be consolidated. Ambient `any` declarations are limited to Bun-only or intentionally open runtime surfaces (`packages/ax-code/src/bun/bun-global.d.ts:70-86`).

## Step 7 Focused Test Evidence

The four targeted files passed together: 4 files and 26 tests. The suite covers compiled executable selection (`packages/ax-code/test/bun/bun-proc.test.ts:4-33`), environment replacement and interpolation escaping (`packages/ax-code/test/bun/node-compat.test.ts:16-43`), file writes and glob options (`packages/ax-code/test/bun/node-compat.test.ts:45-108`), npm command shapes (`packages/ax-code/test/bun/package-manager.test.ts:18-69`), and malformed cache preservation (`packages/ax-code/test/bun.test.ts:77-130`). Coverage should be strengthened for two cases: the runtime test says npm is used “only” for `node-bundled` and omits `node-source` (`packages/ax-code/test/bun/package-manager.test.ts:5-15`), despite source routing both to npm, and there is no assertion that a failed registry lookup is not cached as a successful version check.

## Step 8 Finding Ledger Reconciliation

The bun audit register contains `_none accepted_` at `docs/module-quality-audit/modules/bun/MODULE-AUDIT.md:76-80`, and the reviewed `docs/module-quality-audit/modules/bun/findings/` directory contains no finding files. The transient-failure TTL behavior from Step 3 and the coverage omissions from Step 7 are non-blocking observations recorded here; neither has evidence of data loss, code execution, credential exposure, or an availability failure. There are no Critical severity items requiring an independently signed `reverify.md`, and this pass is the primary `codex-sol` review assigned for slug `bun`.

## Step 9 Verification and Exit Assessment

`AX_TEST_FILES=test/bun/bun-proc.test.ts,test/bun/node-compat.test.ts,test/bun/package-manager.test.ts,test/bun.test.ts pnpm --dir packages/ax-code exec vitest run` passed all 26 tests, and `pnpm --dir packages/ax-code run typecheck` completed with no diagnostics. These checks directly address the pending protocol and sign-off rows at `docs/module-quality-audit/modules/bun/MODULE-AUDIT.md:82-94`. This artifact completes the requested nine-step primary review for `bun`; independent lane metadata is recorded as verifier `ax-code-glm` in `agent-protocol.json`.
