# AX TUI maintenance

The package lives at `packages/ax-tui` in the AX Code monorepo. Run the
commands below from that directory, or prefix them with
`pnpm --dir packages/ax-tui` from the repository root.

AX TUI owns and builds its TypeScript, SolidJS, and native renderer sources.
The source origin and licenses are documented in `UPSTREAM.md`; preserved
behavior is tracked in `DIVERGENCES.md`. There is no upstream bundle-refresh
step in the development workflow.

## TypeScript and SolidJS

The official TypeScript 7.0.2 compiler checks the renderer (`src/`), Solid
integration (`solid/source/`), native delivery (`native/source/`), and widgets.
Solid TSX uses the Babel universal transform through `@defai-digital/ax-tui/solid/transform`.
The Node bundle selects Solid's reactive runtime; Bun retains its own entry.

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm run check
pnpm test
pnpm run check:package
```

`build:renderer` compiles the local source to a temporary directory, emits
declarations, and synchronizes only the generated files listed in
`renderer-artifacts.json`. `check:renderer-dist` rebuilds and compares every
artifact byte. Root JavaScript and declarations are distribution products;
edit their TypeScript source instead. Spinner/chart `dist/` output is also
committed and verified against source.

`check:patches` retains its historical command name but now verifies AX
contracts in source. `apply:patches` is a compatibility alias for
`build:renderer`; there is no JavaScript bundle patcher. The historical
contract documents remain under `patches/` and `solid/patches/`.

## Native builds

Install Zig 0.15.2 (pinned in `.zig-version`), or set `AX_CODE_TUI_ZIG` to that
executable. Yoga and uucode are downloaded by Zig using content hashes from
`native/renderer/build.zig.zon`; populated Zig caches allow offline rebuilding.

```sh
pnpm run test:native
pnpm run build:native                    # current host
pnpm run build:native --target=linux-x64  # one exact target
pnpm run build:native --all              # all eight release targets
pnpm run check:vendor
```

`vendor` is a compatibility alias for `build:native --all`. It never downloads
OpenTUI binaries. The builder checks the compiler version, compiles local
source, validates binary format and architecture, and stages libraries plus
licenses in `vendor/`. It records source hashes and build configuration in
`vendor/manifest.json`. After native source edits, all target builds must be
refreshed; building only the host deliberately leaves other targets stale.

macOS targets require an Apple SDK containing CoreAudio, AudioToolbox, and
CoreFoundation. `AX_CODE_TUI_MACOS_SDK=/path/to/MacOSX.sdk` passes an explicit
SDK to the renderer build; ensure Zig's host SDK discovery uses a compatible
SDK too. Zig 0.15.2 can fail to link with recent Apple SDKs whose `.tbd` stubs
only advertise `arm64e-macos`. Prefer an SDK supported by the pinned compiler.
The initial local validation used a task-local copy of the SDK with arm64
aliases added to those stubs; no system SDK was modified. Other platforms
were cross-compiled; their runtime acceptance must be verified on those hosts.

Native libraries use `libaxtui`/`axtui.dll` and export `axTuiAbiVersion()`.
The TypeScript loader verifies this interface before binding renderer functions.
Advance the ABI version on incompatible FFI changes and rebuild all platforms.
`check:independence` rejects upstream dependencies, native filenames, and terminal
settings in maintained sources and generated runtime artifacts.

The former `OPENTUI_*` terminal overrides have moved to `AX_CODE_TUI_*`
(e.g. `AX_CODE_TUI_GRAPHICS` and `AX_CODE_TUI_NOTIFICATION_PROTOCOL`). Existing
AX-prefixed settings keep their meanings. Public Yoga methods with legacy names
remain deprecated TypeScript forwarding aliases. Changes to the TypeScript FFI
and native ABI must be built and tested together.
Native source, Zig caches, and SDKs are excluded from runtime distributions.

## Runtime and packaging invariants

Use documented package exports (`@defai-digital/ax-tui`, `@defai-digital/ax-tui/solid`, widget, native,
testing, Yoga, and runtime-plugin subpaths). Keep `import.meta.url`-relative
native, worker, and tree-sitter asset resolution intact. Preserve the
`AX_CODE_TUI_*` public environment and runtime identity contracts.

Native resolution maps platform, architecture, and `AX_CODE_TUI_LIBC` to a
bundled library. When absent, `@defai-digital/ax-tui/native` prepares a verified private cache
from AX TUI's version-matched GitHub release. Binary size/SHA-256 and license
SHA-256 must match the manifest. `AX_CODE_TUI_NATIVE_CACHE_DIR` overrides the
cache; `AX_CODE_TUI_NATIVE_OFFLINE=1` forbids downloads. Invalid caches fail
closed. Signed downstream bundles verify their inputs before signing; the
runtime must not reject signed bytes using the unsigned manifest hash.

Node 26+ is the baseline for development, maintenance tools, CI, and Node consumers.
The repository's `.nvmrc` selects Node 26; `package.json` declares the minimum
supported Node version. Native rendering additionally requires `--experimental-ffi`.
Install Corepack separately when needed, and ensure its launcher uses the selected
Node 26 executable rather than an older hard-coded Node path.
Vitest runs the framework and maintenance regressions; `test:native`
runs the Zig suite separately. Downstream applications should additionally
run their own input, rendering, startup, and teardown acceptance tests.

## Releases

Registry publication requires explicit approval. Changes to native bytes
require a new package version and new immutable release assets; do not
replace assets attached to a previously published version.

1. Add a version section to `CHANGELOG.md`; release notes are generated from it.
2. Bump `package.json` for each new version. Versions already published to GitHub Packages are immutable.
3. Run all verification above, including `check:package` and native builds/tests when affected.
4. After approval, push the release commit and matching `v<version>` tag.
5. `.github/workflows/packages.yml` stages verified native libraries and licenses,
   creates the release, checks existing assets byte-for-byte, and publishes the
   public `@defai-digital/ax-tui` package to `https://npm.pkg.github.com`.
   The publish job uses `GITHUB_TOKEN` with `packages: write`.

For a version already released before the registry migration, preserve its existing tag and
native assets. Qualify the migration at the current main commit, publish that version's verified
npm tarball, and record the tested commit and tarball integrity. Later versions use the tag-driven
workflow above.

The npm payload contains generated JavaScript/declarations, widget dist, tree-sitter assets,
and all manifest-verified native libraries/licenses. `check:package` checks the actual npm
pack file list, all export targets, excluded development/private files, and native hashes.
Self-imports use `@defai-digital/ax-tui` and its exported subpaths. Legacy `ax-tui` consumer
imports can use an npm alias; global runtime identities and native cache paths remain stable.
Downstream bundlers should use `prepareNativeLibrary` from `@defai-digital/ax-tui/native`
and preserve the verified library/license pair.

Configure the user-level `~/.npmrc` as described in [README.md](./README.md#install).
For an approved local publication, load the token without adding it to any tracked file:

```sh
export NODE_AUTH_TOKEN="$(cat ~/.gh-packages)"
pnpm run check:package
pnpm run publish:github
```

The classic token needs `write:packages` for publishing and `read:packages` for installs.
`publishConfig` pins the GitHub registry and public access. Verify the package visibility
is `public` in GitHub Packages after publication. GitHub's package settings control the
visibility of an existing package; npm's access flag alone does not replace that setting.
The npm registry still requires a classic token with `read:packages` to install public
packages. Consumer Actions can use `GITHUB_TOKEN` with `packages: read` when granted access.
Runtime support is Node and Bun; the native renderer does not target web browsers or Cloudflare Workers.

## Product quality gates

On macOS and Linux, `pnpm test` also requires Python 3 (standard library only)
for `test/pty-scroll.test.ts`. Run it alone with
`pnpm exec vitest run test/pty-scroll.test.ts`. It launches the real Node renderer
in an OS PTY, feeds SGR wheel input, and reconstructs visible ASCII marker rows
from terminal output rather than native-buffer snapshots. Paired control replies
and output barriers delimit completed frames. The suite checks parked markers
through 12 acknowledged tail updates, wheel direction, bounded mounted rows and
repaints, terminal resize, and clean exit. Virtual row mounting may require a
second layout pass, so the wheel bound permits two frames per event plus four
settling frames; this is a regression bound, not a latency or FPS benchmark.
Unknown screen operations fail rather than silently producing a misleading
snapshot. This fixture does not cover arbitrary Unicode, terminal emulators,
continuous network streams, or Windows ConPTY. Windows explicitly skips this
PTY case and runs the native-buffer and on-demand scheduling regressions.

The Quality workflow runs on branch pushes, pull requests, and release preflight.
It requires Node FFI support, then checks TypeScript, native/source provenance,
the FFI struct-layout contract, all generated output, runtime regressions, and
the Linux npm payload verification. It installs Zig from `.zig-version` and runs `test:native`
on Linux, macOS, and Windows. On macOS the installer copies the active SDK and
adds `arm64-macos` beside `arm64e-macos` stub targets when Zig 0.15.2 would
otherwise skip them. Linux, macOS, and Windows must pass before a release
uploads immutable native assets. Native source changes also require rebuilding
all eight targets. ABI 3 adds the terminal-control FIFO and retains ABI 2's buffer
resize failure reporting; older native libraries are incompatible.
`check:abi` compares `src/core/zig-structs.ts` with `native/renderer/abi-layout.json`.
The Zig suite compares that file with the native `extern` struct offsets. Update
both sides, then run `pnpm exec tsx script/native-abi-layout.ts --write`.

Use `node --experimental-ffi --import tsx script/benchmark-capture.ts` to measure
span capture. It warms up 50 captures, then reports seven samples of 200 captures
and their median. Compare the same machine, runtime, frame, and sample settings.
Do not use this number as a whole-application frame-rate or latency claim.

Parser downloads have a 30 second timeout and 64 MiB size limit. URL-keyed cache
entries use SHA-256; older basename/32-bit-hash entries are not reused. Bundled
local grammars do not require downloads. Failed or incomplete downloads never
replace a valid target file.

Native raw buffer views alias native storage. Callers must reacquire `buffers`
after successful resize and must not use retained views after destruction.
Failed resizes retain the original storage and dimensions. Captured span colors
are independent copies and remain valid after later draws, resize, or destroy.

### Terminal compatibility and application soak

```sh
pnpm run test:terminal
pnpm run test:terminal --tmux              # requires tmux 3.3 or newer
pnpm run test:terminal --tmux /path/to/tmux
pnpm run test:stress 10000                 # optional second argument: uint32 seed
```

The terminal runner uses node-pty with a real POSIX PTY or Windows ConPTY and
an independent xterm.js 6.0.0 headless screen oracle with Unicode 11 widths.
On Windows it selects node-pty 1.1.0's bundled ConPTY 1.23.2510.08001 rather
than the runner's system host. An A/B run of the same application and assertions
showed that the legacy system host drops wide emoji and shifts combining-mark
rows, while the bundled host preserves the full Unicode contract. This qualifies
the bundled host; older Windows console hosts are not covered by that result.
The runner closes the Windows PTY transport even after the application exits,
then explicitly invokes the pinned node-pty connection's drain-aware worker
disposer and waits for termination. Its public kill path otherwise requires
another output event to dispose that worker, which an already drained child
does not produce. Recheck this private development-only cleanup when upgrading
node-pty; the framework runtime does not depend on it.
It checks CJK, combining marks, Greek, wide emoji, truecolor (direct path),
fragmented paste and escape sequences, editing, Tab/Shift-Tab focus, wheel
direction, bounded mounted rows/repaints, 200 asynchronous tail updates, three
resizes, idle convergence, and successful shutdown with screen, paste mode and
cursor restoration. OSC title barriers and a separate loopback control ACK
ensure assertions run after terminal output has been parsed. The tmux path
starts and removes its own server with only `test/fixtures/quality-tmux.conf`;
it never attaches to existing sessions or reads user configuration.

On Windows the fixture explicitly starts with output code page 437, verifies
that the native stdout backend selects UTF-8 while rendering, and checks that
shutdown restores 437. The stdout backend shares its code-page lease across
overlapping writers and preserves later external changes. Redirected stdout,
memory outputs, and feed outputs do not acquire a local console lease.

`pnpm test` requires this direct terminal test on all three CI operating systems;
missing PTY/ConPTY support is a failure. Linux CI also requires the tmux path.
These are protocol and screen-state checks, not font/pixel checks or a claim
that every terminal application is compatible. ZWJ emoji clustering is checked
in native-buffer application stress, not by the Unicode 11 xterm oracle.
Manual qualification of Kitty/WezTerm/Ghostty, browser terminals, SSH sessions,
and platform-specific IME behavior remains separate.

The pinned node-pty development dependency builds locally on Linux and uses
N-API prebuilds on macOS/Windows. Its lifecycle scripts are explicitly allowed
in `pnpm-workspace.yaml`. Version 1.1.0's macOS spawn helper lacks its executable
bit; the runner repairs only that development helper's file mode before use.
Neither node-pty nor xterm.js is a production dependency or publication payload.

The seeded soak mixes a bounded 10,000-item variable-height list with scrolling,
resizing, editor updates, command execution, palette creation/disposal, focus
restoration, and replacement/cancellation of asynchronous image sources. It
asserts visible target rows and Unicode, bounded live renderables and mounts,
stable subscription counts, idle convergence and complete renderable teardown.
Every 100 iterations it samples RSS, post-GC JS heap, array buffers and native
process-arena capacity, plus allocator counters and their validity flags. Output
is drained through a native span feed to the test Writable; the test helper's
default memory destination retains the whole ANSI transcript and is unsuitable
for measuring sustained memory use. After warmup, arena growth must stay below 64 KiB; runs
with at least 500 iterations and explicit GC also bound retained JS heap growth
to 32 MiB. RSS is reported without a pass threshold because allocator residency
is not the same as live allocation. CI runs 500 cycles inside the regular tests
and an additional 1,000-cycle soak on each operating system. Longer local runs
are useful evidence; they do not establish the absence of all leaks.

### Paired performance comparison

```sh
mkdir -p .internal/quality-comparison
npm install --prefix .internal/quality-comparison --save-exact --no-audit --no-fund @opentui/core@0.6.6
pnpm run bench:compare .internal/quality-comparison .internal/performance-comparison.json
```

The reference is an optional, isolated installation, never a project dependency.
Use an exact version and keep its `package-lock.json` with the raw report. Stop
other CPU-heavy work before measuring. The runner does not install packages or
modify either implementation. It alternates package order across seven pairs
of fresh Node processes, with identical 120x40 geometry, warmup, iteration
counts, public APIs and output assertions. Workloads measure ASCII span capture,
Unicode span capture, and updating ten of forty text rows through completed
scheduled frames. Assertions outside timing verify all forty rendered rows,
Unicode content, capture counts, frame advancement and the final text update.

The JSON report retains every sample and pair order, median times and paired
ratios, package/runtime/CPU/OS versions, AX Git HEAD and tracked-diff hash,
native-manifest hash, reference lock hash and harness hashes. Ratios below one
mean AX took less time for that workload. Compare results on the same host and
runtime. These memory-backed renderer measurements exclude terminal transport,
startup and image decoding; they are not whole-application FPS, broad framework
rankings, or evidence of statistical significance. Performance is measured
explicitly rather than using noisy timing thresholds in regular CI.
