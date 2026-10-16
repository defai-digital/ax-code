/**
 * Herdr state reporter (ADR-234).
 *
 * A hook-side, observation-only reporter: it reads one AX Code lifecycle hook
 * payload from stdin (or HOOK_* env) and, when `HERDR_ENV=1` and the `herdr`
 * binary is on PATH, reports the agent state to `herdr pane report-agent`.
 * It never injects keys into any pane and prints nothing on any failure.
 *
 * State mapping:
 *   Notification (kind=idle_prompt)   -> idle      the agent finished and waits
 *   Notification (kind=question)      -> blocked   the agent needs an answer
 *   Notification (kind=background_task)-> working  a background task settled
 *   PermissionRequest                 -> blocked   a permission prompt is open
 *   StopFailure                       -> idle      the turn ended (in failure)
 *   Stop / turn end                   -> idle
 *   anything else                     -> undefined (no report)
 *
 * The mapping function is exported so it can be tested with an injected
 * runner, without spawning anything.
 */

const IDLE = "idle"
const WORKING = "working"
const BLOCKED = "blocked"

/**
 * Map a hook payload to a herdr state, or undefined when the event is not a
 * state transition herdr cares about. Pure: no I/O, no globals.
 */
export function mapHookToState(payload) {
  if (!payload || typeof payload !== "object") return undefined
  const event = typeof payload.event === "string" ? payload.event : payload.hook_event_name
  const args = payload.args && typeof payload.args === "object" ? payload.args : {}
  const kind = typeof args.kind === "string" ? args.kind : undefined

  switch (event) {
    case "Notification":
      if (kind === "question") return BLOCKED
      if (kind === "idle_prompt") return IDLE
      if (kind === "background_task") return WORKING
      return undefined
    case "PermissionRequest":
      return BLOCKED
    case "StopFailure":
    case "Stop":
      return IDLE
    case "UserPromptSubmit":
      return WORKING
    default:
      return undefined
  }
}

/** Parse the payload from HOOK_ARGS_JSON/env or raw stdin text. */
export function parsePayload(stdinText, env) {
  const raw = (stdinText && stdinText.trim()) || env.HOOK_ARGS_JSON
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Report the state to herdr. Returns true only when a report was actually
 * issued. Every failure is swallowed — a broken reporter must never affect a
 * hook or a turn.
 */
export function reportState(payload, deps) {
  const state = mapHookToState(payload)
  if (!state) return false
  if (deps.env.HERDR_ENV !== "1") return false
  const sessionID = typeof payload.args?.sessionID === "string" ? payload.args.sessionID : undefined
  try {
    const result = deps.spawnSync("herdr", ["pane", "report-agent", "--state", state], {
      stdio: "ignore",
      ...(sessionID ? { env: { ...deps.env, HERDR_AGENT_SESSION: sessionID } } : {}),
    })
    return !result.error && result.status === 0
  } catch {
    return false
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

async function main() {
  // Silent on every failure: no stdout/stderr, no non-zero exit.
  const stdinText = process.stdin.isTTY ? "" : await readStdin()
  const payload = parsePayload(stdinText, process.env)
  if (!payload) return
  const { spawnSync } = await import("node:child_process")
  reportState(payload, { env: process.env, spawnSync })
}

main().catch(() => {})
