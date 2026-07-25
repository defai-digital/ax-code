import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Session } from "."
import { SessionPrompt } from "./prompt"
import type { SessionID } from "./schema"
import { formatLoopInterval } from "./prompt-recurring-arguments"

// Loop mode (/loop) — a per-session recurring prompt scheduler
// (ADR-050, SPEC-2026-07-25-loop-mode).
//
// Named SessionRecurring because "loop" already means the agentic step
// loop inside one turn (session/prompt-loop-*.ts); this module schedules
// whole turns on a wall-clock interval instead.
//
// Every tick submits an ordinary prompt turn through SessionPrompt.prompt —
// permissions, questions, autonomous caps, and completion gates all apply
// unchanged. A tick that fires while the session is busy is a counted
// skip, never a queued turn. State is in-memory per backend process by
// design (ADR-050 D4): timers are cleared on instance disposal and loops
// do not survive a restart, which /loop status says out loud.
export namespace SessionRecurring {
  const log = Log.create({ service: "session.recurring" })

  // Hard ceiling per loop: after this many submitted runs the loop stops
  // itself and posts a notice, so an unattended session cannot burn tokens
  // forever (composes with, not replaces, the autonomous caps).
  export const MAX_RUNS = 500

  export type Info = {
    sessionID: SessionID
    prompt: string
    intervalMs: number
    runs: number
    skips: number
    startedAt: number
    lastTickAt?: number
  }

  type Loop = Info & { timer: ReturnType<typeof setInterval> }

  type TickDeps = {
    assertNotBusy?: (sessionID: SessionID) => void
    submit?: (input: { sessionID: SessionID; text: string }) => Promise<unknown>
    publishError?: (input: { sessionID: SessionID; message: string }) => void
  }

  const state = Instance.state(
    () => ({ loops: new Map<SessionID, Loop>() }),
    async (current) => {
      for (const loop of current.loops.values()) clearInterval(loop.timer)
      current.loops.clear()
    },
  )

  function publicInfo(loop: Loop): Info {
    const { timer: _timer, ...info } = loop
    return info
  }

  export function get(sessionID: SessionID): Info | undefined {
    const loop = state().loops.get(sessionID)
    return loop ? publicInfo(loop) : undefined
  }

  export function start(input: { sessionID: SessionID; intervalMs: number; prompt: string }): {
    info: Info
    replaced: boolean
  } {
    const current = state()
    const existing = current.loops.get(input.sessionID)
    if (existing) clearInterval(existing.timer)
    const timer = setInterval(() => {
      void tick(input.sessionID)
    }, input.intervalMs)
    // A loop must never keep a backend alive that would otherwise exit —
    // loops are process-scoped, not a reason for the process to exist.
    timer.unref?.()
    const loop: Loop = {
      sessionID: input.sessionID,
      prompt: input.prompt,
      intervalMs: input.intervalMs,
      runs: 0,
      skips: 0,
      startedAt: Date.now(),
      timer,
    }
    current.loops.set(input.sessionID, loop)
    log.info("loop started", {
      sessionID: input.sessionID,
      intervalMs: input.intervalMs,
      replaced: Boolean(existing),
    })
    return { info: publicInfo(loop), replaced: Boolean(existing) }
  }

  export function stop(sessionID: SessionID): Info | undefined {
    const current = state()
    const loop = current.loops.get(sessionID)
    if (!loop) return undefined
    clearInterval(loop.timer)
    current.loops.delete(sessionID)
    log.info("loop stopped", { sessionID, runs: loop.runs, skips: loop.skips })
    return publicInfo(loop)
  }

  // One scheduler tick. Exported for tests (deps injectable); the timer
  // calls it with defaults. Never throws — a tick failure is logged and
  // the loop keeps its cadence.
  export async function tick(sessionID: SessionID, deps: TickDeps = {}): Promise<"run" | "skip" | "stopped"> {
    const current = state()
    const loop = current.loops.get(sessionID)
    if (!loop) return "stopped"
    loop.lastTickAt = Date.now()

    try {
      ;(deps.assertNotBusy ?? SessionPrompt.assertNotBusy)(sessionID)
    } catch {
      loop.skips += 1
      log.info("loop tick skipped, session busy", { sessionID, skips: loop.skips })
      return "skip"
    }

    loop.runs += 1
    if (loop.runs >= MAX_RUNS) {
      stop(sessionID)
      ;(deps.publishError ?? Session.publishError)({
        sessionID,
        message: `Loop stopped automatically after ${MAX_RUNS} runs. Start it again with /loop if you want to continue.`,
      })
    }

    const submit =
      deps.submit ??
      (async (input: { sessionID: SessionID; text: string }) => {
        // agentRouting "preserve" matches the synthetic-continuation
        // convention: a scheduled re-prompt must not trigger specialist
        // auto-routing away from the session's active agent.
        return SessionPrompt.prompt({
          sessionID: input.sessionID,
          agentRouting: "preserve",
          parts: [{ type: "text", text: input.text }],
        })
      })
    try {
      await submit({ sessionID, text: loop.prompt })
    } catch (error) {
      log.warn("loop tick prompt failed", { sessionID, error: toErrorMessage(error) })
    }
    return "run"
  }

  export function format(info: Info | undefined): string {
    if (!info) {
      return "No loop is running in this session. Start one with /loop <interval> <prompt> (interval like 30s, 5m, 1h)."
    }
    const preview = info.prompt.length > 120 ? `${info.prompt.slice(0, 117)}...` : info.prompt
    const lines = [
      `Loop running every ${formatLoopInterval(info.intervalMs)} — ${info.runs} run(s), ${info.skips} busy-skip(s).`,
      `Prompt: ${preview}`,
      `Stops automatically after ${MAX_RUNS} runs. Stop it any time with /loop stop.`,
      `Note: loops live in this backend process only — they do not survive a restart.`,
    ]
    return lines.join("\n")
  }
}
