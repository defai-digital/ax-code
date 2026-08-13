import type { DesktopSurfaceId } from "@/lib/desktopSurface"

export const WORK_AGENT_NAME = "work"

export type WorkSurfaceSessionIntent = {
  agent: typeof WORK_AGENT_NAME
  metadata: {
    work: {
      version: 1
      computer: boolean
      providerID?: string
      modelID?: string
    }
  }
}

/** Work-surface new sessions are Work agent sessions with product metadata (PRD R1). */
export function workSurfaceSessionIntent(
  surface: DesktopSurfaceId,
  input?: { computer?: boolean; providerID?: string; modelID?: string },
): WorkSurfaceSessionIntent | null {
  if (surface !== "work") return null
  return {
    agent: WORK_AGENT_NAME,
    metadata: {
      work: {
        version: 1,
        computer: input?.computer ?? false,
        providerID: input?.providerID,
        modelID: input?.modelID,
      },
    },
  }
}

export function resolveWorkSurfaceAgent(input: {
  surface: DesktopSurfaceId
  explicitAgent?: string
  fallbackAgent?: string
}) {
  if (input.explicitAgent) return input.explicitAgent
  if (input.surface === "work") return WORK_AGENT_NAME
  return input.fallbackAgent
}
