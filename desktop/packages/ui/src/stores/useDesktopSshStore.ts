import { create } from "zustand"
import {
  createDesktopSshInstance,
  desktopSshConnect,
  desktopSshDisconnect,
  desktopSshImportHosts,
  desktopSshInstancesGet,
  desktopSshInstancesSet,
  desktopSshStatus,
  listenDesktopSshStatus,
  type DesktopSshImportCandidate,
  type DesktopSshInstance,
  type DesktopSshInstanceStatus,
} from "@/lib/desktopSsh"

type DesktopSshState = {
  instances: DesktopSshInstance[]
  statusesById: Record<string, DesktopSshInstanceStatus>
  importCandidates: DesktopSshImportCandidate[]
  isLoading: boolean
  isSaving: boolean
  isImportsLoading: boolean
  initialized: boolean
  listenerReady: boolean
  error: string | null
  load: () => Promise<void>
  loadImports: () => Promise<void>
  refreshStatuses: () => Promise<void>
  upsertInstance: (instance: DesktopSshInstance) => Promise<void>
  createFromCommand: (id: string, sshCommand: string, nickname?: string) => Promise<void>
  removeInstance: (id: string) => Promise<void>
  setInstances: (instances: DesktopSshInstance[]) => Promise<void>
  connect: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  retry: (id: string) => Promise<void>
  getStatus: (id: string) => DesktopSshInstanceStatus | null
  clearError: () => void
}

const byUpdatedAt = (a: DesktopSshInstanceStatus, b: DesktopSshInstanceStatus) => {
  return b.updatedAtMs - a.updatedAtMs
}

const toStatusMap = (statuses: DesktopSshInstanceStatus[]): Record<string, DesktopSshInstanceStatus> => {
  const statusMap: Record<string, DesktopSshInstanceStatus> = {}
  for (const status of [...statuses].sort(byUpdatedAt)) {
    statusMap[status.id] = status
  }
  return statusMap
}

const mergeNewerStatuses = (
  current: Record<string, DesktopSshInstanceStatus>,
  incoming: Record<string, DesktopSshInstanceStatus>,
): Record<string, DesktopSshInstanceStatus> => {
  let next = current
  for (const status of Object.values(incoming)) {
    const existing = next[status.id]
    if (existing && existing.updatedAtMs > status.updatedAtMs) {
      continue
    }
    if (next === current) {
      next = { ...current }
    }
    next[status.id] = status
  }
  return next
}

const pickStatusMapEntries = (
  statusesById: Record<string, DesktopSshInstanceStatus>,
  ids: Set<string>,
): Record<string, DesktopSshInstanceStatus> => {
  const picked: Record<string, DesktopSshInstanceStatus> = {}
  for (const [id, status] of Object.entries(statusesById)) {
    if (ids.has(id)) {
      picked[id] = status
    }
  }
  return picked
}

const configuredInstanceIds = new Set<string>()

const replaceConfiguredInstanceIds = (instances: DesktopSshInstance[]) => {
  configuredInstanceIds.clear()
  for (const instance of instances) {
    configuredInstanceIds.add(instance.id)
  }
}

const upsertNewerStatus = (
  current: Record<string, DesktopSshInstanceStatus>,
  status: DesktopSshInstanceStatus,
): Record<string, DesktopSshInstanceStatus> => {
  const existing = current[status.id]
  if (existing && existing.updatedAtMs > status.updatedAtMs) {
    return current
  }
  return {
    ...current,
    [status.id]: status,
  }
}

export const useDesktopSshStore = create<DesktopSshState>((set, get) => ({
  instances: [],
  statusesById: {},
  importCandidates: [],
  isLoading: false,
  isSaving: false,
  isImportsLoading: false,
  initialized: false,
  listenerReady: false,
  error: null,

  load: async () => {
    if (get().isLoading) return
    set({ isLoading: true, error: null })
    try {
      const [config, statuses] = await Promise.all([desktopSshInstancesGet(), desktopSshStatus()])
      const statusMap = toStatusMap(statuses)
      const configuredIds = new Set(config.instances.map((instance) => instance.id))
      replaceConfiguredInstanceIds(config.instances)

      if (!get().listenerReady) {
        await listenDesktopSshStatus((status) => {
          if (!configuredInstanceIds.has(status.id)) {
            return
          }
          set((state) => ({
            statusesById: upsertNewerStatus(state.statusesById, status),
          }))
        })
      }

      set((state) => ({
        instances: config.instances,
        statusesById: mergeNewerStatuses(statusMap, pickStatusMapEntries(state.statusesById, configuredIds)),
        isLoading: false,
        initialized: true,
        listenerReady: true,
      }))
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  loadImports: async () => {
    if (get().isImportsLoading) return
    set({ isImportsLoading: true, error: null })
    try {
      const importCandidates = await desktopSshImportHosts()
      set({ importCandidates, isImportsLoading: false })
    } catch (error) {
      set({
        isImportsLoading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  refreshStatuses: async () => {
    try {
      const statuses = await desktopSshStatus()
      const statusMap = toStatusMap(statuses)
      set((state) => {
        const knownIds = new Set(state.instances.map((instance) => instance.id))
        return {
          statusesById: mergeNewerStatuses(
            pickStatusMapEntries(statusMap, knownIds),
            pickStatusMapEntries(state.statusesById, knownIds),
          ),
        }
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  setInstances: async (instances) => {
    set({ isSaving: true, error: null })
    try {
      await desktopSshInstancesSet({ instances })
      replaceConfiguredInstanceIds(instances)
      set({ instances, isSaving: false })
      await get().refreshStatuses()
    } catch (error) {
      set({
        isSaving: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },

  upsertInstance: async (instance) => {
    const current = get().instances
    const next = current.some((item) => item.id === instance.id)
      ? current.map((item) => (item.id === instance.id ? instance : item))
      : [instance, ...current]
    await get().setInstances(next)
  },

  createFromCommand: async (id, sshCommand, nickname) => {
    const instance = createDesktopSshInstance(id, sshCommand)
    if (nickname && nickname.trim()) {
      instance.nickname = nickname.trim()
    }
    await get().upsertInstance(instance)
  },

  removeInstance: async (id) => {
    await desktopSshDisconnect(id).catch(() => undefined)
    const next = get().instances.filter((item) => item.id !== id)
    await get().setInstances(next)
    set((state) => {
      const statusesById = { ...state.statusesById }
      delete statusesById[id]
      return { statusesById }
    })
  },

  connect: async (id) => {
    set({ error: null })
    try {
      await desktopSshConnect(id)
      await get().refreshStatuses()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  disconnect: async (id) => {
    set({ error: null })
    try {
      await desktopSshDisconnect(id)
      await get().refreshStatuses()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  retry: async (id) => {
    await get().connect(id)
  },

  getStatus: (id) => {
    return get().statusesById[id] || null
  },

  clearError: () => set({ error: null }),
}))
