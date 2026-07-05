import { axCodeClient } from "@/lib/ax-code/client"
import { useProjectsStore } from "@/stores/useProjectsStore"

export const getActiveConfigDirectory = (sourceLabel: string): string | null => {
  try {
    const projectsStore = useProjectsStore.getState()
    const activeProject = projectsStore.getActiveProject?.()

    if (activeProject?.path?.trim()) {
      return activeProject.path.trim()
    }

    const clientDirectory = axCodeClient.getDirectory()
    if (clientDirectory?.trim()) {
      return clientDirectory.trim()
    }
  } catch (error) {
    console.warn(`[${sourceLabel}] Error resolving config directory:`, error)
  }

  return null
}
