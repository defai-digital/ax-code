// Tracks the viewed session's status across reactive effect re-runs and
// reports the exact busy/retry -> idle transitions worth notifying about.
// The baseline resets whenever the viewed session (or route) changes, so a
// stale busy status from a previously viewed session can never mis-fire
// "Task complete" for the session just switched to.
export function createTurnCompleteTracker() {
  let lastSessionID: string | undefined
  let lastSessionStatus: string | undefined
  let count = 0

  // Pass sessionID undefined when the current route is not a session. Returns
  // a unique fire-once key when the viewed session transitioned from
  // busy/retry to idle; the monotonic count keeps each transition's key
  // unique while unrelated re-renders return undefined. Otherwise undefined.
  function update(sessionID: string | undefined, status: string | undefined) {
    if (sessionID === undefined) {
      lastSessionID = undefined
      lastSessionStatus = undefined
      return undefined
    }
    if (sessionID !== lastSessionID) {
      lastSessionID = sessionID
      lastSessionStatus = undefined
    }
    const wasWorking = lastSessionStatus === "busy" || lastSessionStatus === "retry"
    lastSessionStatus = status
    if (!wasWorking || status !== "idle") return undefined
    count += 1
    return `turn-complete:${sessionID}:${count}`
  }

  return { update }
}
