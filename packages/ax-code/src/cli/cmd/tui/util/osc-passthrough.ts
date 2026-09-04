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
    let chunk = ""
    let bytes = 0
    // Screen limits bytes, while string offsets count UTF-16 code units.
    // Split only between complete code points so each envelope stays valid UTF-8.
    for (const character of sequence) {
      const size = Buffer.byteLength(character, "utf8")
      if (bytes + size > SCREEN_PASSTHROUGH_CHUNK_SIZE) {
        wrapped += `\x1bP${chunk}\x1b\\`
        chunk = ""
        bytes = 0
      }
      chunk += character
      bytes += size
    }
    if (chunk) wrapped += `\x1bP${chunk}\x1b\\`
    return wrapped
  }
  return sequence
}
