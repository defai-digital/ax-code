type ObservedMember = { id: string; status: string | undefined }

/** Tracks observed work, not task success. Missing state never proves idle. */
export function createTurnCompleteTracker() {
  let lastSessionID: string | undefined
  let members = new Set<string>()
  const active = new Set<string>()
  let suppressed = false
  let count = 0

  function reset() {
    lastSessionID = undefined
    members = new Set()
    active.clear()
    suppressed = false
  }

  function suppress(sessionID: string | undefined) {
    if (sessionID !== undefined && members.has(sessionID)) suppressed = true
  }

  function update(
    sessionID: string | undefined,
    status: string | undefined,
    context: {
      members?: readonly ObservedMember[]
      pending?: boolean
      ready?: boolean
      failedMembers?: readonly string[]
    } = {},
  ) {
    if (sessionID === undefined || context.ready === false) {
      reset()
      return undefined
    }
    if (sessionID !== lastSessionID) {
      reset()
      lastSessionID = sessionID
    }
    const previousMembers = members
    const observed = context.members ?? [{ id: sessionID, status }]
    members = new Set(observed.map((member) => member.id))
    const statuses = new Map(observed.map((member) => [member.id, member.status]))
    // Deletion or sparse resync cannot stand in for a terminal idle event.
    if ([...active].some((id) => !members.has(id) || statuses.get(id) === undefined)) {
      active.clear()
      suppressed = true
    }
    for (const member of observed) {
      if (member.status === "busy" || member.status === "retry") active.add(member.id)
    }
    if (context.failedMembers?.some((id) => active.has(id) && statuses.get(id) === "idle")) suppressed = true
    if (status !== "idle" || context.pending) return undefined
    if ([...active].some((id) => statuses.get(id) !== "idle")) return undefined
    if (observed.some((member) => member.status === undefined && !previousMembers.has(member.id))) {
      suppressed = true
      return undefined
    }
    const notify = active.size > 0 && !suppressed
    active.clear()
    suppressed = false
    if (!notify) return undefined
    count += 1
    return `turn-complete:${sessionID}:${count}`
  }

  return { update, reset, suppress }
}
