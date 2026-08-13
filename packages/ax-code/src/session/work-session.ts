import { Session } from "@/session"
import { SessionMetadata } from "@/session/metadata"

export const WORK_AGENT_NAME = "work"

export function createWorkProductMetadata(input?: {
  computer?: boolean
  providerID?: string
  modelID?: string
}): SessionMetadata.Work {
  return SessionMetadata.Work.parse({
    version: 1,
    computer: input?.computer ?? false,
    providerID: input?.providerID,
    modelID: input?.modelID,
  })
}

export function workSessionCreateIntent(input?: {
  computer?: boolean
  providerID?: string
  modelID?: string
}) {
  return {
    agent: WORK_AGENT_NAME,
    metadata: {
      work: createWorkProductMetadata(input),
    },
  }
}

export function isWorkSessionMetadata(metadata: Record<string, unknown> | undefined) {
  return SessionMetadata.product(metadata).work !== undefined
}

export async function createWorkSession(input?: {
  title?: string
  computer?: boolean
  providerID?: string
  modelID?: string
}) {
  const session = await Session.create({ title: input?.title })
  return Session.setProductMetadata({
    sessionID: session.id,
    namespace: "work",
    value: createWorkProductMetadata(input),
  })
}
