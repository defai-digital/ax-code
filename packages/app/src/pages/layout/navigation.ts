import { type Session } from "@ax-code/sdk/v2/client"
import { type LocalProject } from "@/context/layout"

export const sessionIndexByOffset = (sessions: Pick<Session, "id">[], current: string | undefined, offset: number) => {
  if (sessions.length === 0) return
  const index = current ? sessions.findIndex((session) => session.id === current) : -1
  if (index === -1) return offset > 0 ? 0 : sessions.length - 1
  return (index + offset + sessions.length) % sessions.length
}

export const projectByOffset = <T extends Pick<LocalProject, "worktree">>(
  projects: T[],
  active: string | undefined,
  offset: number,
) => {
  if (projects.length === 0) return
  const index = active ? projects.findIndex((project) => project.worktree === active) : -1
  if (index === -1) return offset > 0 ? projects[0] : projects[projects.length - 1]
  return projects[(index + offset + projects.length) % projects.length]
}

export const unseenSessionIndex = (
  sessions: Pick<Session, "id">[],
  current: string | undefined,
  offset: number,
  unseen: (session: Pick<Session, "id">) => number,
) => {
  if (sessions.length === 0) return
  if (!sessions.some((session) => unseen(session) > 0)) return

  const active = current ? sessions.findIndex((session) => session.id === current) : -1
  const start = active === -1 ? (offset > 0 ? -1 : 0) : active

  for (let i = 1; i <= sessions.length; i++) {
    const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
    const session = sessions[index]
    if (!session || unseen(session) === 0) continue
    return index
  }
}
