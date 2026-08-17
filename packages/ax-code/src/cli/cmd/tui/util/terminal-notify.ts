// Terminal-native notifications (ported from kimi-code): OSC 9 on terminals
// that support it, a bare BEL as fallback elsewhere. Each notification carries
// a fire-once key so reactive re-renders cannot spam the terminal.

type NotifyStream = {
  write: (chunk: string) => boolean
  writable?: boolean
  destroyed?: boolean
  isTTY?: boolean
}

type NotifyEnv = Record<string, string | undefined>

const SUPPORTED_TERM_PROGRAMS = new Set(["iTerm.app", "WezTerm", "ghostty", "WarpTerminal"])
const SUPPORTED_TERMS = new Set(["xterm-kitty", "xterm-ghostty"])

// Whole OSC sequence (ESC ] 9 ; <payload> BEL) must fit in 240 chars.
const MAX_SEQUENCE_LENGTH = 240
const OSC_PREFIX = "\x1b]9;"
const OSC_SUFFIX = "\x07"
const MAX_PAYLOAD_LENGTH = MAX_SEQUENCE_LENGTH - OSC_PREFIX.length - OSC_SUFFIX.length

const firedKeys = new Set<string>()

export function supportsTerminalNotification(env: NotifyEnv = process.env) {
  if (env.TERM_PROGRAM && SUPPORTED_TERM_PROGRAMS.has(env.TERM_PROGRAM)) return true
  if (env.TERM && SUPPORTED_TERMS.has(env.TERM)) return true
  return false
}

// Strip control characters (including BEL/ESC, which would terminate or
// corrupt the OSC sequence) and collapse whitespace runs. The C1 range
// (\x80-\x9f) must go too: it contains CSI/OSC/ST, which some terminals
// still honor and which would otherwise break out of the OSC 9 payload.
function sanitize(value: string) {
  return value
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function notifyTerminal(
  input: { title: string; body: string; key: string },
  stream: NotifyStream = process.stdout,
  env: NotifyEnv = process.env,
) {
  // Consume the key up front: a notification is attempted at most once per
  // key, even when the stream turns out to be degraded.
  if (firedKeys.has(input.key)) return false
  firedKeys.add(input.key)

  // Redirected stdout must stay byte-clean; BEL and OSC escapes are only
  // meaningful to a terminal and would otherwise corrupt captured output.
  if (stream.isTTY === false || stream.writable === false || stream.destroyed) return false

  const title = sanitize(input.title)
  const body = sanitize(input.body)
  let sequence: string
  if (supportsTerminalNotification(env)) {
    const payload = `${title}: ${body}`.slice(0, MAX_PAYLOAD_LENGTH)
    sequence = `${OSC_PREFIX}${payload}${OSC_SUFFIX}`
    // tmux strips unknown escape sequences unless they are wrapped in a DCS
    // passthrough with every ESC doubled.
    if (env.TMUX) sequence = `\x1bPtmux;${sequence.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`
  } else {
    // Unsupported terminal: BEL still flashes/beeps in most terminals.
    sequence = OSC_SUFFIX
  }

  try {
    stream.write(sequence)
    return true
  } catch {
    return false
  }
}

// Test hook: clear the fire-once registry.
export function resetTerminalNotificationKeys() {
  firedKeys.clear()
}
