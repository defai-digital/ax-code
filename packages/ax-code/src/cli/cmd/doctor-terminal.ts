/**
 * Terminal and multiplexer diagnostics for `ax-code doctor terminal`
 * (ADR-223). Read-only: reports TERM, TERM_PROGRAM, multiplexer detection,
 * the tmux options that gate clipboard and passthrough behavior, and OSC 52 /
 * DCS passthrough readiness derived from the existing helpers. No fixes are
 * applied, and no environment values beyond the named variables are
 * reported.
 */

import { Process } from "../../util/process"
import { oscMuxFromEnv } from "../../cli/tui/util/osc-passthrough"

export type TerminalDoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

export type TerminalDoctorCheckEntry = TerminalDoctorCheck & { id: string }

/** Reads one global tmux option value (`tmux show-options -gv <name>`). */
export type TmuxOptionSource = (name: string) => Promise<string | undefined>

const TMUX_OPTION_TIMEOUT_MS = 1_000

/**
 * Read one global tmux option. Returns undefined when tmux is absent, the
 * command fails, or it exceeds the 1 s timeout; callers treat that as
 * "unknown" rather than "off".
 */
export async function readTmuxOption(name: string): Promise<string | undefined> {
  try {
    const result = await Process.run(["tmux", "show-options", "-gv", name], {
      timeout: TMUX_OPTION_TIMEOUT_MS,
      nothrow: true,
    })
    if (result.code !== 0) return undefined
    const value = result.stdout.toString().trim()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function isSet(value: string | undefined): boolean {
  return (value ?? "").trim().length > 0
}

export async function runTerminalDoctorChecks(
  input: {
    env?: Record<string, string | undefined>
    tmuxOption?: TmuxOptionSource
  } = {},
): Promise<TerminalDoctorCheckEntry[]> {
  const env = input.env ?? process.env
  const tmuxOption = input.tmuxOption ?? readTmuxOption
  const checks: TerminalDoctorCheckEntry[] = []
  const push = (id: string, check: TerminalDoctorCheck) => checks.push({ id, ...check })

  // Named variables only (ADR-223 D2). The TMUX value is a socket path, so
  // multiplexer rows report presence, never the value.
  const term = isSet(env.TERM) ? (env.TERM as string) : "(unset)"
  const termProgram = isSet(env.TERM_PROGRAM) ? (env.TERM_PROGRAM as string) : "(unset)"
  push("terminal", {
    name: "Terminal",
    status: "ok",
    detail: `TERM ${term}; TERM_PROGRAM ${termProgram}`,
  })

  const inTmux = isSet(env.TMUX)
  const mux = oscMuxFromEnv(env)
  const multiplexer = inTmux ? "tmux" : mux === "screen" ? "GNU Screen" : isSet(env.ZELLIJ) ? "Zellij" : "none"
  push("multiplexer", {
    name: "Multiplexer",
    status: "ok",
    detail:
      multiplexer === "none"
        ? "none detected; tmux options not applicable"
        : `${multiplexer} session detected${multiplexer === "tmux" ? "" : "; tmux options not applicable"}`,
  })

  let setClipboard: string | undefined
  let allowPassthrough: string | undefined
  if (inTmux) {
    setClipboard = await tmuxOption("set-clipboard")
    allowPassthrough = await tmuxOption("allow-passthrough")
    const extendedKeys = await tmuxOption("extended-keys")
    // Option rows are facts; the derived readiness rows below carry the
    // judgment, so a value is never double-flagged.
    push("tmux-set-clipboard", {
      name: "tmux set-clipboard",
      status: "ok",
      detail: setClipboard ?? "(unset; tmux default external)",
    })
    push("tmux-allow-passthrough", {
      name: "tmux allow-passthrough",
      status: "ok",
      detail: allowPassthrough ?? "(unset)",
    })
    push("tmux-extended-keys", {
      name: "tmux extended-keys",
      status: "ok",
      detail: extendedKeys ?? "(unset)",
    })
  }

  switch (mux) {
    case "tmux": {
      if (setClipboard === "off") {
        push("osc52-clipboard", {
          name: "OSC 52 clipboard",
          status: "warn",
          detail: "tmux set-clipboard is off; OSC 52 writes cannot reach the host terminal clipboard",
        })
      } else {
        push("osc52-clipboard", {
          name: "OSC 52 clipboard",
          status: "ok",
          detail: `tmux set-clipboard ${setClipboard ?? "(unset; default external)"} forwards OSC 52 to the host terminal`,
        })
      }
      if (allowPassthrough === "on" || allowPassthrough === "all") {
        push("dcs-passthrough", {
          name: "DCS passthrough",
          status: "ok",
          detail: `tmux allow-passthrough ${allowPassthrough}; wrapped OSC sequences pass through`,
        })
      } else if (allowPassthrough === "off") {
        push("dcs-passthrough", {
          name: "DCS passthrough",
          status: "warn",
          detail:
            "tmux allow-passthrough is off; wrapped OSC sequences (notifications, progress) are dropped before the host terminal",
        })
      } else {
        push("dcs-passthrough", {
          name: "DCS passthrough",
          status: "warn",
          detail:
            "tmux allow-passthrough is not set; tmux 3.3+ defaults to off, so wrapped OSC sequences (notifications, progress) may not reach the host terminal",
        })
      }
      break
    }
    case "screen": {
      push("osc52-clipboard", {
        name: "OSC 52 clipboard",
        status: "ok",
        detail:
          "OSC 52 is wrapped for GNU Screen (BEL terminator, 252-byte DCS chunks); host terminal support still required",
      })
      push("dcs-passthrough", {
        name: "DCS passthrough",
        status: "ok",
        detail: "GNU Screen DCS chunking in use; host terminal support still required",
      })
      break
    }
    default: {
      push("osc52-clipboard", {
        name: "OSC 52 clipboard",
        status: "ok",
        detail: isSet(env.ZELLIJ)
          ? "no multiplexer wrapping applied for Zellij; depends on Zellij and host terminal support"
          : "direct OSC 52 write; depends on host terminal support",
      })
      push("dcs-passthrough", {
        name: "DCS passthrough",
        status: "ok",
        detail: "no multiplexer wrapping required",
      })
    }
  }

  const colorterm = isSet(env.COLORTERM) ? (env.COLORTERM as string) : undefined
  const truecolor = colorterm !== undefined && /truecolor|24bit/i.test(colorterm)
  push("truecolor", {
    name: "Truecolor",
    status: "ok",
    detail: truecolor
      ? `24-bit color advertised (COLORTERM=${colorterm})`
      : `not advertised (COLORTERM ${colorterm ?? "unset"})`,
  })

  return checks
}
