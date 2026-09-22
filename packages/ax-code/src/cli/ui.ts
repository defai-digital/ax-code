import z from "zod"
import { EOL } from "os"
import { NamedError } from "@ax-code/util/error"
import { logo as figlet } from "./logo"

export namespace UI {
  export const CancelledError = NamedError.create("UICancelledError", z.void())

  // ANSI escape sequences are elided (resolved to "") when NO_COLOR is set
  // (no-color.org: any value disables color) or when stderr is not a TTY, so a
  // piped stderr never receives raw escape codes. Each key is a getter so the
  // decision is made lazily at access time — callers that set NO_COLOR or stub
  // isTTY after import still observe the correct value. The export shape (same
  // keys) is preserved for existing `UI.Style.<KEY>` imports.
  function color(sequence: string): string {
    if (process.env.NO_COLOR !== undefined) return ""
    if (process.stderr.isTTY !== true) return ""
    return sequence
  }

  export const Style = {
    get TEXT_HIGHLIGHT() {
      return color("\x1b[96m")
    },
    get TEXT_HIGHLIGHT_BOLD() {
      return color("\x1b[96m\x1b[1m")
    },
    get TEXT_DIM() {
      return color("\x1b[90m")
    },
    get TEXT_DIM_BOLD() {
      return color("\x1b[90m\x1b[1m")
    },
    get TEXT_NORMAL() {
      return color("\x1b[0m")
    },
    get TEXT_NORMAL_BOLD() {
      return color("\x1b[1m")
    },
    get TEXT_WARNING() {
      return color("\x1b[93m")
    },
    get TEXT_WARNING_BOLD() {
      return color("\x1b[93m\x1b[1m")
    },
    get TEXT_DANGER() {
      return color("\x1b[91m")
    },
    get TEXT_DANGER_BOLD() {
      return color("\x1b[91m\x1b[1m")
    },
    get TEXT_SUCCESS() {
      return color("\x1b[92m")
    },
    get TEXT_SUCCESS_BOLD() {
      return color("\x1b[92m\x1b[1m")
    },
    get TEXT_INFO() {
      return color("\x1b[94m")
    },
    get TEXT_INFO_BOLD() {
      return color("\x1b[94m\x1b[1m")
    },
  }

  export function println(...message: string[]) {
    print(...message)
    process.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    process.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo(pad?: string): string
  export function logo(opts: { pad?: string }): string
  export function logo(arg?: string | { pad?: string }) {
    const pad = typeof arg === "string" ? arg : arg?.pad
    // The figlet-style shading already provides visual depth, so a single bold
    // accent color (TEXT_HIGHLIGHT) reads clearly without looking noisy.
    const fg = Style.TEXT_HIGHLIGHT_BOLD
    const reset = Style.TEXT_NORMAL
    return figlet
      .map((line) => (pad ?? "") + fg + line + reset)
      .join(EOL)
      .trimEnd()
  }

  export function error(message: string) {
    if (message.startsWith("Error: ")) {
      message = message.slice("Error: ".length)
    }
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
