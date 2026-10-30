# `stdin-parser-timeout`

`StdinParser` buffers an in-progress escape sequence (a CSI/OSC/SS3 reply from
the terminal -- cursor position reports, palette queries, Kitty keyboard
negotiation) until it sees a valid final byte, or until `timeoutMs` of
inactivity elapses, at which point it force-flushes whatever it has and
resets to the ground state. The bundled `CliRenderer` constructor hardcoded
`timeoutMs: 20`.

20ms assumes the two halves of a split terminal reply always land in the same
Node event-loop tick. Under real load -- heavy stdout redraw traffic, a busy
renderer thread, an extra PTY hop through an embedded/desktop terminal -- a
reply routinely arrives across two separate `stdin` reads more than 20ms
apart. When the timeout fires mid-sequence, the parser has already lost the
context that it was mid-sequence: the second half's bytes re-enter the state
machine in the ground state and are re-parsed one at a time as literal
printable keystrokes, landing in whatever currently has focus. That is the
mechanism behind stray fragments (`29H`, `[0;0;0m`, `8;73`) appearing in the
chat input or transcript -- not corrupted rendering, but orphaned tail bytes
of an abandoned escape sequence typed in as text.

## Contract

1. The default idle timeout for assembling a pending escape sequence is
   100ms, matching vim's `ttimeoutlen` default for the equivalent
   escape-sequence disambiguation problem: enough headroom for real I/O
   jitter under load, while staying under the threshold where a standalone
   Escape keypress would feel laggy.
2. `CliRendererConfig.stdinParserTimeoutMs` overrides the default without
   editing generated output.

Regression: `script/tui-patches.test.ts` and `pnpm run check:patches`.
