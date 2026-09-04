// Shared tmux / GNU Screen DCS wrapping for OSC sequences (clipboard, notify).
// Screen consumes an inner ST as the DCS end, so OSC payloads must terminate
// with BEL and be forwarded as `\x1bP`…`\x1b\\` chunks (OpenTUI #1334).

export type OscMux = "none" | "tmux" | "screen"

export const SCREEN_PASSTHROUGH_CHUNK_SIZE = 252

export function oscMuxFromEnv(env: Record<string, string | undefined> = process.env): OscMux {
  if (env.TMUX) return "tmux"
  if (env.STY) return "screen"
  return "none"
}

export function wrapOscForMux(sequence: string, mux: OscMux): string {
  if (mux === "tmux") {
    return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`
  }
  if (mux === "screen") {
    let wrapped = ""
    for (let offset = 0; offset < sequence.length; offset += SCREEN_PASSTHROUGH_CHUNK_SIZE) {
      wrapped += `\x1bP${sequence.slice(offset, offset + SCREEN_PASSTHROUGH_CHUNK_SIZE)}\x1b\\`
    }
    return wrapped
  }
  return sequence
}
