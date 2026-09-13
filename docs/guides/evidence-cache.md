# Local evidence cache

Status: Default enabled

Scope: current-state

Last reviewed: 2026-09-13

Owner: ax-code runtime

AX Code can use an optional RocksDB cache alongside its existing SQLite storage. SQLite retains complete session history and verification records. The cache contains disposable rendered text and syntactic symbols; it does not change permissions or count as fresh verification.

Evidence reuse is enabled by default and prefers RocksDB. Source installations build its native support with:

```sh
pnpm build:native fs
pnpm run dev
```

Use `AX_CODE_EVIDENCE_CACHE=memory` for bounded in-process reuse without persistent storage. Missing native support, a database lock held by another runtime, or a cache failure falls back to memory with a diagnostic. Standard filesystem addon builds include RocksDB. Release builds verify the packaged addon can write and reopen its cache. Native operations run off the JavaScript event loop.

Text reads up to 1 MiB validate current source bytes and reuse the rendered range when its content, path, range and format match. Larger files, external reads, directories and attachments do not enter the read cache. Repository instructions and file-read stamps remain live. Syntactic extraction can reuse symbols for identical source and language; these symbols do not establish semantic references or callers.

With either cache mode, repeated complete text read results already visible in the current model request use a short reference to the first result. The original full tool outputs remain in session history. Compaction rebuilds visibility; a later read is rendered in full if its earlier copy is absent. Instruction-bearing, media and truncated results are not omitted.

Cache hits save rendering or parsing; they do not eliminate source validation reads or model-requested tool calls. To combine dependent discovery into fewer model round trips, explicitly enable the existing `experimental.read_only_recipes` option and use `read_recipe` with bounded selections. Use `code_intelligence` with `operation: "buildContext"` for a bounded structural overview. Neither option is enabled automatically by the cache.

The cache lives under the normal AX Code cache directory in `evidence-v1`, with a separate database per project instance directory. RocksDB admission is limited to 1024 entries and 32 MiB of logical values; physical disk usage also includes encoding, logs and compaction overhead. In-memory reuse is limited to 128 entries and 4 MiB. Entries expire after 24 hours and are validated on lookup. Capacity eviction may clear the disposable native entries as a batch. No existing SQLite data is migrated or backfilled.

To disable both storage reuse and model-input deduplication, set `AX_CODE_EVIDENCE_CACHE=off` and restart AX Code. An unset or empty value uses RocksDB; an unrecognized nonempty value disables the cache. No SQLite rollback is needed. Stop runtimes before manually removing `evidence-v1`; do not remove RocksDB lock files while a runtime is using the cache.

For local native qualification after building the feature:

```sh
cd packages/ax-code
AX_TEST_EVIDENCE_NATIVE=1 AX_TEST_FILES=test/evidence/cache-native.test.ts,test/evidence/cache-eval.test.ts pnpm exec vitest run --retry 0
```

The fixed-fixture evaluation reports requested reads, rendering hits, omitted output bytes and elapsed time separately. It is not a live-model benchmark or a claim about provider token billing.

When reporting an issue, include the AX Code version, OS/architecture, `ax-code doctor` output, whether `off` or `memory` changes the behavior, and a reproducible task if available. Doctor reports requested mode and native capability; it cannot determine whether another running process owns the project cache. Project lock/I/O fallback appears in the runtime log. No feedback or cached source content is uploaded automatically. Existing published binaries acquire these defaults only after an updated release is installed.
