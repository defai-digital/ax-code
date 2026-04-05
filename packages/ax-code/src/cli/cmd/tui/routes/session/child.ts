type Session = {
  id: string
  parentID?: string | null
}

export function firstChildID(children: Session[]) {
  if (children.length <= 1) return
  return children.find((item) => !!item.parentID)?.id
}

export function nextChildID(children: Session[], current: string | undefined, direction: number) {
  if (children.length <= 1) return
  const sessions = children.filter((item) => !!item.parentID)
  if (sessions.length === 0) return
  let next = sessions.findIndex((item) => item.id === current) + direction
  if (next >= sessions.length) next = 0
  if (next < 0) next = sessions.length - 1
  return sessions[next]?.id
}

export function childAction(parentID: string | undefined, depth: number) {
  return !!parentID && depth === 0
}
