# Split-footer wire-byte regression

Run `node --experimental-ffi --test test/fixtures/split-footer-bytes.mjs` after
building. The Vitest wrapper runs it as part of `pnpm test`.
`AX_TUI_BYTE_BASELINE=1` disables the performance assertions for measurement.

The fixture uses the real native output feed, a recording stdout, and xterm's
terminal decoder. It paints a 12-row footer, then submits 30 commits cycling
through one, two, and three seven-byte transcript rows. Each commit gets a
frame. A separate test changes one footer cell during relocation. The resize
scenario submits 100 consecutive terminal-resize notifications, alternating
between width/height +1 and +2, then waits for the 100 ms debounce to settle.
Startup and teardown bytes are excluded from the measured phases.

This is a deterministic framework benchmark, not a reproduction of AX Code's
70 ms streaming workload. At 200x60, commits 21-24 still relocate the footer;
the tail phase must not be described as entirely steady state. The main-screen
comparison replaces a three-row live transcript below the same footer rather
than appending durable history. Its partial cell diffs naturally contain fewer
transcript bytes. Resize includes blank cells outside the footer in that mode.

All numbers below are wire bytes. The categories are disjoint: transcript text,
footer text (including padding), cursor/scroll/SGR/sync controls, and erase
commands. For main-screen, text classification uses the emitted cursor row so
partial transcript diffs are not misclassified as footer repainting.

| Mode / size / phase | Before total | After total | Before: transcript / footer / controls / clears | After: transcript / footer / controls / clears |
| --- | ---: | ---: | --- | --- |
| Split 80x24, commits 1-20 | 10789 | 2642 | 273 / 5760 / 4535 / 221 | 273 / 0 / 2192 / 177 |
| Split 80x24, commits 21-30 | 1424 | 1384 | 147 / 0 / 1184 / 93 | 147 / 0 / 1144 / 93 |
| Split 80x24, resize burst | 1882 | 1387 | 0 / 984 / 898 / 0 | 0 / 984 / 403 / 0 |
| Split 200x60, commits 1-20 | 58493 | 2646 | 273 / 48000 / 9887 / 333 | 273 / 0 / 2196 / 177 |
| Split 200x60, commits 21-30 | 12598 | 1398 | 147 / 9600 / 2726 / 125 | 147 / 0 / 1158 / 93 |
| Split 200x60, resize burst | 3322 | 2827 | 0 / 2424 / 898 / 0 | 0 / 2424 / 403 / 0 |
| Main 80x24, commits 1-20 | 2518 | 2518 | 213 / 0 / 2305 / 0 | 213 / 0 / 2305 / 0 |
| Main 80x24, commits 21-30 | 1315 | 1315 | 110 / 0 / 1205 / 0 | 110 / 0 / 1205 / 0 |
| Main 80x24, resize burst | 2960 | 2960 | 1148 / 984 / 828 / 0 | 1148 / 984 / 828 / 0 |
| Main 200x60, commits 1-20 | 2518 | 2518 | 213 / 0 / 2305 / 0 | 213 / 0 / 2305 / 0 |
| Main 200x60, commits 21-30 | 1315 | 1315 | 110 / 0 / 1205 / 0 | 110 / 0 / 1205 / 0 |
| Main 200x60, resize burst | 14468 | 14468 | 10100 / 2424 / 1944 / 0 | 10100 / 2424 / 1944 / 0 |

Split resize applications fall from 100 to 1. With no pending commits, the
original renderer already deferred the actual repaint until the next frame;
the byte saving in this tight burst is therefore 99 pixel-resolution queries.
The new queued-output regression additionally pins one populated footer repaint
with no intermediate blank repaint. No committed rows are replayed.

The unchanged-footer budget is transcript bytes plus at most 250 control/erase
bytes per one-to-three-row commit, independent of footer area. The terminal
decoder checks every footer row after every commit, and the raw stream checks
transcript markers exactly once and in order. Additional tests cover a single
changed cell and queued rows during resize settlement, a return to original
geometry, and destruction before the debounce expires.

The current fixture was copied into an isolated archive of the original HEAD
and run against its original generated JS and native binary. Both byte-budget
cases failed (5760 and 48000 footer bytes instead of zero), both pending-resize
cases failed because output escaped before settlement, and the single-cell
case failed (960 bytes instead of one). The two main-screen cases passed.
The extra return-to-original-geometry test was added afterward.

The PTY harness now checks that its 200 queued rows remain queued while its
manual clock is paused during the burst, then drain after settlement. Native
wire-shape assertions now require insert-line relocation and one SGR reset
instead of clears and redundant resets. These replace implementation-specific
expectations; transcript order, exactly-once delivery, footer integrity,
shutdown cursor placement, SIGTERM draining, and forbidden escape checks
remain enforced. Explicit public `resize()` remains synchronous; terminal
resize notifications use the existing configurable debounce interval.

Validation on macOS arm64 / Node 26.5.0:

- `pnpm run build`, `pnpm run typecheck`, and `pnpm run check`: passed.
- Host native build and all eight native target builds: passed, with updated
  manifest provenance and generated artifacts.
- `pnpm run test:native`: 1675 passed, 3 skipped.
- Byte fixture: 8 passed. Split-footer, scrollback-surface, and real POSIX PTY
  regressions passed; tmux variants were skipped because tmux was unavailable.
- `pnpm test`: 895 passed, 3 skipped, 1 environment-blocked failure. The unrelated
  terminal-quality harness attempts a localhost listener and receives `EPERM`
  from the sandbox. The dedicated split-footer PTY harness uses inherited file
  descriptors and passes, including SIGTERM.
- `git diff --check`: passed.

The sandbox also disallows tsx's IPC socket. Validation temporarily replaced
only the local, untracked `node_modules/.bin/tsx` launcher with
`node --import tsx`; the original launcher was restored afterward. Zig used
cached dependencies in writable scratch space and the existing compatible SDK.
No source checks, byte budgets, or correctness assertions were disabled in the
post-change verification. No commit, tag, or publication was made.
