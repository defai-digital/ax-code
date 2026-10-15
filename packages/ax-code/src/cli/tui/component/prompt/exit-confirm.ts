export const EXIT_CONFIRM_WINDOW_MS = 2_000

// Only a plain Ctrl+C is confirmed. Ctrl+D and the leader binding still exit on
// the first press, so this predicate excludes any added modifier and matches
// the literal "c" key the terminal reports for Ctrl+C.
export function isPlainCtrlC(input: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }): boolean {
  return input.ctrl === true && !input.meta && !input.shift && input.name === "c"
}

// Two-press exit gate: the first press arms a short window and asks for
// confirmation, the second press inside the window exits. An expired window (or
// an explicit reset from any other key) re-arms instead of exiting, so a stray
// Ctrl+C never quits the app.
export function createExitConfirmGate(input: { now: () => number; windowMs?: number }) {
  const windowMs = input.windowMs ?? EXIT_CONFIRM_WINDOW_MS
  let armedAt: number | undefined

  return {
    press(): "arm" | "exit" {
      const now = input.now()
      if (armedAt !== undefined && now - armedAt <= windowMs) {
        armedAt = undefined
        return "exit"
      }
      armedAt = now
      return "arm"
    },
    reset() {
      armedAt = undefined
    },
  }
}
