# AX TUI performance and WASM evaluation

AX TUI keeps its Zig native renderer as the production backend. Tree-sitter
already runs as WASM in a worker. A separate, source-only width experiment
evaluates WASM portability and call overhead without changing the renderer ABI,
package exports, installation requirements, or backend selection.

## Implementation plan

1. Establish repeatable framework workloads for streaming Markdown, a long
   virtualized conversation, resize/reflow, and large syntax-highlighted code.
2. Record completed frames and verify visible results. Attribute work to
   mutation, root rendering, styled-text submission, native diff/ANSI generation,
   native output, and asynchronous highlighting. Keep raw samples and source
   identities so later optimizations can be compared against the same workload.
3. Build the production Unicode width implementation for both a small native
   library and freestanding WASM, using the same pinned compiler, dependency,
   Unicode table fields, batch ABI, and optimization mode.
4. Qualify parity and invalid-input handling, then compare resident computation
   and complete encoding/copy/call/result costs in alternating fresh processes.
5. Retain native as the default. A full portable backend requires a separate
   product need and evaluation of the complete renderer and host integration.

## Application workloads

From the repository root, with workspace dependencies installed:

```sh
pnpm --dir packages/ax-tui run bench:application
```

The default report is
`packages/ax-tui/.internal/benchmarks/application.json`. It contains seven fresh
process samples, each with eight warmup operations and forty measured operations
per workload. A shorter run is useful while developing the harness:

```sh
pnpm --dir packages/ax-tui run bench:application --samples=1 --iterations=2 --warmup=1
```

The workloads are:

| Workload          | Behavior                                                                        | Correctness check                                                |
| ----------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `stream-markdown` | Append Unicode paragraphs and TypeScript fences to a sticky-bottom conversation | Latest chunk is visible after highlighting and layout settle     |
| `scroll-history`  | Jump through 10,000 variable-height Unicode messages                            | Target row is visible and mounting stays bounded                 |
| `resize-text`     | Cycle 80x24, 120x40, and 160x50 while reflowing Unicode text                    | Dimensions and the latest Unicode header match                   |
| `large-code`      | Replace a 2,002-line TypeScript document                                        | Updated code is visible and real syntax highlights were produced |

Markdown and code use the bundled Tree-sitter WASM grammars and real worker.
No mock parser or network parser installation is used. Every operation waits
for outstanding highlights and requested frames, verifies output outside the
timed interval, and destroys its renderables and worker afterward. The native
span feed drains into a counting Writable instead of retaining an ANSI transcript.

Each raw operation records wall time, synchronous mutation time, root render
time, styled-text submission time and chunk count, native diff/ANSI time, native
output time, completed frames, cells, output bytes, highlight request count and
latency, CPU, and event-loop utilization. Native timing values are converted
from microseconds to milliseconds. Memory snapshots include heap, external
buffers, and process RSS. Reports include runtime/host identity, Git HEAD and
tracked-diff hash, native source and artifact-manifest hashes, and harness hashes
(including newly added harness files that are not yet in Git).

These phase timings overlap. Root rendering can contain FFI and styled-text
work; native output delivery is asynchronous; highlight request latency includes
worker scheduling, parsing, queries, and message transfer. Do not sum the fields
or subtract them to claim isolated JavaScript or FFI overhead. RSS includes
worker heaps and caches and is not an allocation or leak measurement.

Use a separate diagnostic run to collect Node CPU profiles:

```sh
pnpm --dir packages/ax-tui run bench:application --samples=1 --iterations=3 --warmup=1 --profile
```

Each sample gets a profile directory beside the report. Node assigns distinct
profile names to the main thread and workers. Open `.cpuprofile` files in a CPU
profile viewer. Profiling adds overhead; compare performance with unprofiled
runs using identical parameters and an otherwise idle host.

The harness measures imperative framework usage. It excludes Solid
reconciliation, the complete AX Code application, a real PTY, terminal emulator,
and SSH latency. It does not establish end-user latency or whole-application FPS.

## Native/WASM width experiment

Install Zig from `packages/ax-tui/.zig-version` (currently 0.15.2), or set
`AX_CODE_TUI_ZIG` to that compiler. Build and compare:

```sh
pnpm --dir packages/ax-tui run build:wasm-experiment
pnpm --dir packages/ax-tui run bench:wasm-experiment
```

`build:wasm-experiment` optionally accepts an output directory. To benchmark it,
pass `--directory=/absolute/path`. Benchmark flags use `--name=value` and support
`--samples`, `--iterations`, `--warmup`, and `--output`. Samples are bounded to
1-31, iterations to 1-10,000, and warmup to 0-10,000; invalid or duplicate flags
fail instead of silently changing the experiment.

On macOS, Zig 0.15.2 may need the compatible SDK prepared by
`script/ci-install-zig.ts`. CI installs it automatically. Local installations
must make that script's `ax-tui-xcrun` wrapper available on PATH and set
`AX_CODE_TUI_MACOS_SDK` to the prepared SDK, or use an already compatible SDK.

Generated artifacts, caches, manifest, and reports stay under
`packages/ax-tui/.internal/`. The experiment is excluded from the published
package and has no production import or automatic fallback.

The kernel imports `native/renderer/utf8.zig`. Its build uses the production
uucode URL/hash and the same four Unicode table fields. Both arms use
`ReleaseFast`; native targets the build host and WASM targets
`wasm32-freestanding` with SIMD128. WASM has no imports or WASI dependency.

The versioned batch ABI has 1 MiB of UTF-8 input, 4,096 offset/length pairs,
and one width per item. It supports `unicode`, `wcwidth`, and `no_zwj`, plus
tab widths 1-255. It validates the whole batch before writing results. Invalid
ranges, capacity, options, and UTF-8 fail explicitly. Input strings use
TextEncoder semantics, including replacement of isolated UTF-16 surrogates.
This prototype has static per-module storage and is synchronous and
non-reentrant; callers must not interleave native instances sharing one library.
The JavaScript adapter owns returned results, rejects reads after failed work
or close, and reacquires WASM memory views for each operation.

Each comparison has seven pairs, alternating native/WASM order, with each arm
in a fresh process. The WASM process runs without `--experimental-ffi`.
Golden Unicode widths are checked before timing; both arms must produce the
same output checksum for every corpus. Workloads cover one short ASCII or
Unicode string, 256 ASCII or Unicode lines, and 64 longer Unicode blocks.

Each timing observation performs twenty batches. Two modes expose different costs:

- `resident-kernel`: prepared input remains in backend memory; measures the
  exported call, input validation, and width calculation.
- `encode-copy-run-read`: includes string encoding, range packing, input copies,
  the call, and an owned result copy.

The report retains all samples, paired ratios, artifact/source/compiler identity,
load-and-verification time, and process memory snapshots. WASM linear-memory
size is reported separately. A ratio below one means WASM took less time for
that corpus and mode. `loadAndVerifyMs` includes source/artifact hashing and
module loading; it is not isolated WASM compilation time. These kernel results
are not evidence that a complete WASM renderer is faster.

## Qualification and adoption

```sh
pnpm --dir packages/ax-tui run typecheck
pnpm --dir packages/ax-tui run check
pnpm --dir packages/ax-tui test
```

The normal test suite always checks workload reporting and batch packing.
Compiled native/WASM tests run when the experiment is built. CI builds it on
Linux, macOS, and Windows, then requires the parity suite: golden widths,
1,000 seeded Unicode texts across all three modes and four tab widths,
byte-boundary UTF-8 rejection, capacity limits, invalid ranges/options,
owned result lifetime, recovery, artifact provenance, and WASM without FFI.
No noisy timing threshold is a CI gate.

A portable backend is justified when installation or browser embedding is an
explicit requirement. Before making it a default, qualify full rendering,
startup, peak/retained memory, p95 operation latency, Unicode/style/link parity,
resize, terminal controls, and backpressure against native on supported hosts.
TTY input, signals, output transport, audio, threading, callbacks, and pointer
layouts still need host adapters or a redesigned interface. The width prototype
does not provide those facilities or remove FFI from the complete application.

## Initial local findings

Measured on 2026-11-08 on Apple M5 Max, macOS arm64, Node 26.13.0, Zig 0.15.2.
The width comparison used seven alternating fresh-process pairs, 100 warmup
batches per mode, and 40 observations of 20 batches each. Both artifacts use
the same production Unicode source and generated table selection.

| Full encoding/copy/call/result workload | Native median ms/batch | WASM median ms/batch | WASM/native |
| --------------------------------------- | ---------------------: | -------------------: | ----------: |
| One short ASCII string                  |               0.001663 |             0.001157 |        0.70 |
| One short Unicode string                |               0.001260 |             0.000808 |        0.64 |
| 256 ASCII lines                         |               0.034842 |             0.035539 |        1.02 |
| 256 Unicode lines                       |               0.150609 |             0.172332 |        1.14 |
| 64 longer Unicode blocks                |               0.472998 |             0.554317 |        1.17 |

WASM reduced the cost of tiny calls in this ABI, while the larger Unicode
batches took about 14-17% longer. Its artifact was 230,050 bytes and its linear
memory was 1,572,864 bytes. These are a single-host kernel result, not a
renderer speed comparison or an application memory estimate. Native remains
the production choice; WASM remains an optional portability experiment.

The raw report is `packages/ax-tui/.internal/benchmarks/text-width.json`.
Rerun on each intended host rather than treating these numbers as universal.

The application run used seven fresh processes, two warmup operations and five
measured operations per workload (35 measured operations each), without CPU
profiling. Operation distributions were:

| Workload                           | Median ms/operation | p95 ms/operation |
| ---------------------------------- | ------------------: | ---------------: |
| Streaming Markdown                 |               2.009 |            2.347 |
| Long conversation jumps            |               9.180 |           11.519 |
| Resize/reflow                      |               1.850 |            2.039 |
| Large highlighted code replacement |            1233.597 |         1343.268 |

Large code replacement submitted 46,003 styled chunks per operation. Its median
styled-text submission time was 1,187.975 ms, compared with 30.366 ms of highlight
request latency and 0.094 ms of native frame diff/ANSI time. A separate CPU
profile located most sampled CPU work in the FFI invocation beneath
`textBufferSetStyledText`. Styled-text construction is therefore the priority
for a targeted follow-up, including chunk volume and native highlight insertion.
The original native `setStyledText` inserted highlights per chunk, and each
`addHighlightByCharRangeInternal` call walked the rope's lines. This identified
indexed range lookup as a concrete optimization before replacing the execution
backend.
These nested measurements do not isolate pure FFI call overhead and do not
establish that compiling this path to WASM would improve it.

The original application report is preserved as
`packages/ax-tui/.internal/benchmarks/application-before-highlight-index.json`.

## Indexed native highlight insertion

The production native renderer now locates highlight ranges through the rope's
existing lazy line-start marker index. An upper-bound binary search finds the
first relevant line, and insertion stops when the range ends. This changes each
range lookup from a complete line scan to O(log(lines) + lines in the range).
The marker cache rebuilds once after a text edit and is reused by later chunks;
no separate per-chunk line index or new allocation is introduced.

Marker weights include newlines. The highlight API preserves its existing
newline-excluded display-column offsets by subtracting the marker's line index.
Equal offsets from empty lines use an upper bound so highlights beginning at a
line boundary skip preceding empty lines. Colors, attributes, hyperlink IDs,
chunk boundaries, range clipping, and the native ABI remain unchanged.

`native/renderer/tests/text-buffer-highlights_test.zig` compares insertion with
an independent full-line-walk oracle. Tests cover every start/end boundary in
small documents, leading/adjacent/trailing empty lines, LF/CRLF, tabs, combining
marks, CJK, emoji, replacement and append, 1,500 seeded ranges over a 300-line
document across three width modes, and repeated multiline styled chunks with
hyperlink reference cleanup. The same regressions passed before and after the
optimization. The package's eight native targets must be rebuilt together.

The production renderer continues to use native code. The WASM width kernel
remains a development experiment.

### Before/after results

The same Apple M5 Max and Node 26.13.0 host ran seven fresh processes before
and after indexing, with two warmup and five measured operations per workload.
The renderer JavaScript artifact manifest, harness file hashes, runtime, and
workload parameters match. The rebuilt native libraries use Zig 0.15.2 and
`ReleaseFast`; local native qualification used the compatible macOS 26.5 SDK.

| Workload                           | Before median ms | After median ms | Before p95 ms | After p95 ms |
| ---------------------------------- | ---------------: | --------------: | ------------: | -----------: |
| Streaming Markdown                 |            2.009 |           1.965 |         2.347 |        2.065 |
| Long conversation jumps            |            9.180 |           9.824 |        11.519 |       11.827 |
| Resize/reflow                      |            1.850 |           1.849 |         2.039 |        2.009 |
| Large highlighted code replacement |         1233.597 |          91.281 |      1343.268 |       96.341 |

Large code replacement was approximately 13.5 times faster in this workload.
Its median styled-text submission fell from 1,187.975 ms to 46.915 ms, while
the input still contained 46,003 styled chunks. Every operation's tick, completed
frame count, updated cell count, output byte count, and styled chunk count match
the baseline. Native regression tests independently check highlight ranges,
style definitions, and hyperlink lifetimes; matching byte counts alone are not
an assertion of byte-for-byte output equality.

These are sequential before/after samples on a single host, not an alternating
paired experiment or a statistical significance result. The small differences
in other workloads include scheduling variability; no across-the-board speedup
is claimed. Real terminal latency and full AX Code/Solid behavior remain outside
this harness.

Raw reports are preserved under `packages/ax-tui/.internal/benchmarks/`:

- `application-before-highlight-index.json`
- `application-after-highlight-index.json`
- `highlight-index-comparison.json`

Indexed-only qualification passed 1,679 native tests (2 skips) and 933 package tests
(1 skip), including compiled native/WASM parity. All eight native target
libraries were rebuilt and verified against the same source digest. TypeScript,
22-struct ABI layout, generated renderer output, and package payload checks pass.
Native runtime tests ran on macOS; the other target binaries were cross-compiled.

## Ordered native style spans

Profiling the indexed build separated roughly 33 ms in the native styled-text
call from roughly 12-14 ms of JavaScript packing/encoding in the 47 ms submission.
Native stack sampling identified repeated allocation of per-line boundary events
and active-highlight hash maps inside `rebuildLineSpans` as the next hotspot.
The diagnostic sample is retained as
`packages/ax-tui/.internal/benchmarks/styled-text-after-index.sample.txt`.

Native span rebuilding now recognizes ordered, non-overlapping highlights and
emits their spans in a linear pass. It reuses the existing output array after
warmup, without temporary event arrays, sorting, or an active-highlight map.
The output keeps leading/interior/trailing default-style gaps, separate adjacent
same-style boundaries, and the existing treatment of endpoints beyond line width.
Overlapping or unordered highlights continue through the original priority sweep.
The highlight list, style IDs, colors, links, and ABI are preserved.

`native/renderer/tests/text-buffer-spans_test.zig` checks full span sequences
against an independent boundary-partition oracle. It covers ordered and
unordered input, overlaps with distinct priorities, removal transitions,
out-of-line endpoints including the maximum u32, empty and Unicode lines across
three width methods, and 400 seeded cases of 24 ranges. A failing allocator test
proves that warmed ordered rebuilding makes no temporary allocations; this test
failed against the old event-sweep implementation and passes with the fast path.

### Paired span results

The same Apple M5 Max and Node 26.13.0 host ran seven alternating pairs of fresh
processes, with two warmup and five measured operations per workload in each
process. Both arms used identical JavaScript and harness files. The indexed-only
reference library was recovered from the previous Zig build cache and matched
its recorded SHA-256; both native artifacts were hash-checked before and after
each child run. Both use Zig 0.15.2, `ReleaseFast`, and the compatible macOS 26.5
SDK. The reference and candidate source digests are recorded in the raw report.

The median columns below summarize the seven per-process medians. The p95
columns summarize all 35 measured operations in each arm.

| Workload                           | Indexed median ms | Span fast-path median ms | Indexed p95 ms | Span fast-path p95 ms |
| ---------------------------------- | ----------------: | -----------------------: | -------------: | --------------------: |
| Streaming Markdown                 |             1.998 |                    1.992 |          3.224 |                 2.349 |
| Long conversation jumps            |             9.042 |                    9.773 |         10.714 |                10.846 |
| Resize/reflow                      |             1.843 |                    1.841 |          2.035 |                 2.022 |
| Large highlighted code replacement |           107.763 |                   64.540 |        110.944 |                68.956 |

Large code replacement was approximately 1.67 times faster, with latency reduced
by 40%. Every pair improved, with candidate/reference latency ratios of
0.575-0.623. Median styled-text submission across all operations fell from
61.779 ms to 18.366 ms, a 70% reduction. Input still contained 46,003 styled
chunks per operation. This comparison isolates the additional span optimization;
its reference is the indexed build, rather than the original unoptimized build.

Every operation's tick, completed frame count, updated cell count, output byte
count, and styled chunk count matched in the completed paired report. An earlier
attempt observed extra completed frames without changes to cells, bytes, or
chunks during asynchronous Markdown scheduling. The comparison driver records
frame counts separately and requires cell/byte/chunk counts to match. Native
regressions independently check semantics; output counts do not prove identical
output bytes.

Long conversation jumps had an approximately 8% higher median in this run;
their styled-text submission medians were both about 0.149 ms. This is an
observed result, with no established cause or general speedup claim. The initial
unpaired candidate run also showed substantial variation across unchanged
workloads. Those results are retained rather than discarded. Background load
was not controlled, and these single-host results do not establish statistical
significance, real-terminal latency, or full AX Code/Solid performance.

Raw evidence is retained under `packages/ax-tui/.internal/benchmarks/`:

- `linear-spans-paired-comparison.json`, including all samples, identities, and
  harness hashes
- `compare-span-backends.mjs`, the local alternating comparison driver
- `application-after-linear-spans.json`, the initial unpaired run
- `linear-spans-paired-run.log`, the earlier frame-count mismatch

Final qualification passed 1,683 native tests (2 skips) and 933 package tests
(1 skip), including compiled native/WASM parity. All eight native libraries were
rebuilt and verified against the same source digest. TypeScript, 22-struct ABI
layout, generated renderer artifacts, package payload, and repository structure
checks passed. The native ABI remains version 3. Native runtime tests ran on
macOS; the other seven target binaries were cross-compiled.

## Scroll follow-up and safe chunk packing

The span follow-up repeated just the scroll workload in eleven alternating
native-library pairs, with eight warmup and forty measured operations per child
(440 operations per arm). The indexed reference's median of run medians was
9.340 ms; the span candidate's was 10.139 ms. Pooled operation medians were
9.656 and 9.986 ms, with p95 values of 16.233 and 17.168 ms. All cell, byte,
chunk, and frame counts matched. Six pair medians were slower and five were
faster. A separate, instrumented 200-operation diagnostic reversed direction,
at 7.328 versus 6.739 ms; instrumentation changes execution and those numbers
must not be combined with the uninstrumented comparison. The investigation
has not established a cause for the scroll difference or shown that it is
eliminated. Raw evidence is in `scroll-native-paired-comparison.json`,
`scroll-native-before-phases.json`, `scroll-native-after-phases.json`, and
`scroll-current.cpuprofile` under the benchmark directory.

Checking styled-chunk marshaling also exposed a reproducible color lifetime
defect. The color transform returned only a raw pointer. Colors created while
normalizing string input could lose their owning array before the packed struct
was consumed. A forced-GC regression read corrupted color values with that
implementation. The transform now passes the color array view to the existing
struct packer, which retains it with the packed buffer. The shared transform
also fixes temporary colors in cursor-style options. No native ABI change is
needed.

Already normalized `RGBA` chunks with absent or string links now pass through
the mapping step directly. This avoids normalization wrappers and an object
copy for the common case. String colors and object links retain their existing
normalization path. The generic struct packer still owns encoding, layout and
pointer retention; no specialized ABI writer or persistent scratch buffer was
introduced.

`test/zig-structs.test.ts` packs 1,080 combinations of foreground/background
colors, links, and text, forces GC, and decodes the results. It covers RGB,
indexed/default color metadata, temporary string colors, temporary cursor
colors, embedded NULs, Unicode and isolated surrogates, null/absent fields,
frozen inputs, and list/single/offset packing. The old pointer transform failed
the regression; the retained-view transform passes.

A packing-only comparison used 46,001 chunks captured from the real large-code
workload's initial Tree-sitter output. Seven alternating fresh-process pairs
used ten warmup and twenty measured packs per arm. Median of process medians
fell from 14.032 to 13.502 ms, a 3.8% reduction; every pair improved. Both arms
kept the original input `RGBA` values reachable. This measurement does not claim
that the unsafe reference handles temporary normalized colors correctly, or
that the whole application is 3.8% faster. The raw report is
`chunk-normalization-paired.json`; its driver and corpus hashes are recorded.
An earlier pilot overlapped local type checking and is retained separately as
`chunk-normalization-paired-pilot.json`.

The production before/after application runs each used seven fresh processes,
four warmup operations and ten measured operations per workload. Both native
manifests matched, and all ticks, cells, bytes and styled-chunk counts matched.
These sequential runs did not show an overall latency improvement: large-code
run medians were 62.645 and 65.047 ms, and the other workload medians were also
higher. Reports are retained as `application-before-normalization.json` and
`application-after-normalization.json`. They are not alternating pairs, and
background load was uncontrolled.

An additional seven-pair application comparison alternated the original and
current styled-chunk packer definitions in an identical submission wrapper,
using the same generated runtime and native library. Both copied definitions
import that runtime's `RGBA` class; only styled-text packing changes between
arms. Each child again used four warmup and ten measured operations per workload.
This is a targeted packer comparison, rather than two complete package builds.
The report and exact copied-definition hashes are in
`normalization-application-paired.json`.

| Workload                           | Original packer median ms | Current packer median ms | Original p95 ms | Current p95 ms |
| ---------------------------------- | ------------------------: | -----------------------: | --------------: | -------------: |
| Streaming Markdown                 |                     2.025 |                    2.044 |           2.305 |          2.246 |
| Long conversation jumps            |                     9.870 |                    9.731 |          11.926 |         11.970 |
| Resize/reflow                      |                     1.932 |                    1.931 |           2.073 |          2.041 |
| Large highlighted code replacement |                    63.084 |                   62.243 |          70.301 |         67.664 |

Median columns summarize per-process medians; p95 summarizes all 70 operations
per arm. All ticks, cells, output bytes and styled-chunk counts matched.
Markdown completed-frame counts varied while those output counts matched;
frame counts matched for the other three workloads. Large-code styled-text
submission medians were 17.364 and 17.256 ms. These small application differences
do not establish a general speedup. The concrete correction is safe ownership
of temporary color storage, with a modest packing-only reduction in this local
measurement.

Qualification passed 934 package tests (1 skip), including the forced-GC
regression, native/WASM experiment parity, and terminal/application acceptance.
TypeScript, generated renderer output, all native vendor hashes, 22-struct ABI
layout, package payload and repository structure checks passed. Native sources
and ABI version 3 are unchanged by this TypeScript correction.
