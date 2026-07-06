import { create } from "zustand"
import { devtools, persist, createJSONStorage } from "zustand/middleware"
import { emitConfigChange, scopeMatches, subscribeToConfigChanges } from "@/lib/configSync"
import { startConfigUpdate, finishConfigUpdate, updateConfigUpdateMessage } from "@/lib/configUpdate"
import { getSafeStorage } from "./utils/safeStorage"
import { sleep, waitForAxCodeConnection } from "./utils/axCodeConnection"
import { API_ENDPOINTS, replacePathParams } from "@/lib/http"
import { parseConfigPathGroup } from "@/lib/configPathGroup"
import { getAxCodeCurrentDirectory } from "@/lib/ax-code/currentDirectory"
import { getDirectoryCacheKey } from "@/stores/utils/cacheKey"

export type SkillScope = "user" | "project"
export type SkillSource = "ax-code" | "claude" | "agents"

export interface SupportingFile {
  name: string
  path: string
  fullPath: string
}

export interface SkillSources {
  md: {
    exists: boolean
    path: string | null
    dir: string | null
    fields: string[]
    scope?: SkillScope | null
    source?: SkillSource | null
    supportingFiles: SupportingFile[]
    // Actual content values
    name?: string
    description?: string
    instructions?: string
  }
  projectMd?: { exists: boolean; path: string | null }
  claudeMd?: { exists: boolean; path: string | null }
  projectAgentsMd?: { exists: boolean; path: string | null }
  userMd?: { exists: boolean; path: string | null }
  userClaudeMd?: { exists: boolean; path: string | null }
  userAgentsMd?: { exists: boolean; path: string | null }
}

export interface DiscoveredSkill {
  name: string
  path: string
  scope: SkillScope
  source: SkillSource
  description?: string
  /** Domain folder parsed from file path, e.g. "automation-ai", "lark-ecosystem" */
  group?: string
}

// Raw skill response from API before transformation
interface RawSkillResponse {
  name: string
  path: string
  scope?: SkillScope
  source?: SkillSource
  sources?: {
    md?: {
      description?: string
    }
  }
}

export interface SkillConfig {
  name: string
  description: string
  instructions?: string
  scope?: SkillScope
  source?: SkillSource
  targetPath?: string
  supportingFiles?: Array<{ path: string; content: string }>
}

export interface PendingFile {
  path: string
  content: string
}

export interface SkillDraft {
  name: string
  scope: SkillScope
  source?: SkillSource
  description: string
  instructions?: string
  pendingFiles?: PendingFile[]
}

export interface SkillDetail {
  name: string
  sources: SkillSources
  scope?: SkillScope | null
  source?: SkillSource | null
}

interface SkillsStore {
  selectedSkillName: string | null
  skills: DiscoveredSkill[]
  isLoading: boolean
  skillDraft: SkillDraft | null

  setSelectedSkill: (name: string | null) => void
  setSkillDraft: (draft: SkillDraft | null) => void
  loadSkills: () => Promise<boolean>
  getSkillDetail: (name: string) => Promise<SkillDetail | null>
  createSkill: (config: SkillConfig) => Promise<boolean>
  updateSkill: (name: string, config: Partial<SkillConfig>) => Promise<boolean>
  deleteSkill: (name: string) => Promise<boolean>
  getSkillByName: (name: string) => DiscoveredSkill | undefined

  // Supporting files
  readSupportingFile: (skillName: string, filePath: string) => Promise<string | null>
  writeSupportingFile: (skillName: string, filePath: string, content: string) => Promise<boolean>
  deleteSupportingFile: (skillName: string, filePath: string) => Promise<boolean>
}

const CONFIG_EVENT_SOURCE = "useSkillsStore"
const SKILLS_LOAD_CACHE_TTL_MS = 5000
const skillsLastLoadedAt = new Map<string, number>()
const skillsLoadInFlight = new Map<string, Promise<boolean>>()
const skillsLoadRequestIds = new Map<string, number>()
let skillsLoadSequence = 0

export const useSkillsStore = create<SkillsStore>()(
  devtools(
    persist(
      (set, get) => ({
        selectedSkillName: null,
        skills: [],
        isLoading: false,
        skillDraft: null,

        setSelectedSkill: (name: string | null) => {
          set({ selectedSkillName: name })
        },

        setSkillDraft: (draft: SkillDraft | null) => {
          set({ skillDraft: draft })
        },

        loadSkills: async () => {
          const currentDirectory = getAxCodeCurrentDirectory()
          const cacheKey = getDirectoryCacheKey(currentDirectory)
          const now = Date.now()
          const loadedAt = skillsLastLoadedAt.get(cacheKey) ?? 0
          const hasCachedSkills = get().skills.length > 0

          if (hasCachedSkills && now - loadedAt < SKILLS_LOAD_CACHE_TTL_MS) {
            return true
          }

          const inFlight = skillsLoadInFlight.get(cacheKey)
          if (inFlight) {
            return inFlight
          }

          const requestId = ++skillsLoadSequence
          skillsLoadRequestIds.set(cacheKey, requestId)
          const isCurrentLoad = () => skillsLoadSequence === requestId && skillsLoadRequestIds.get(cacheKey) === requestId

          const request = (async () => {
            set({ isLoading: true })
            const previousSkills = get().skills
            let lastError: unknown = null

            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

                const response = await fetch(`${API_ENDPOINTS.config.skills}${queryParams}`)
                if (!response.ok) {
                  throw new Error(`Failed to list skills: ${response.status}`)
                }

                const data = await response.json()
                const rawSkills: RawSkillResponse[] = data.skills || []
                const configSkills: DiscoveredSkill[] = rawSkills.map((s) => ({
                  name: s.name,
                  path: s.path,
                  scope: s.scope ?? "user",
                  source: s.source ?? "ax-code",
                  description: s.sources?.md?.description || "",
                  group: parseConfigPathGroup(s.path, { segment: "skills", minimumPartsForGroup: 3 }),
                }))

                if (!isCurrentLoad()) return true
                set({ skills: configSkills, isLoading: false })
                skillsLastLoadedAt.set(cacheKey, Date.now())
                return true
              } catch (error) {
                lastError = error
                const waitMs = 200 * (attempt + 1)
                await new Promise((resolve) => setTimeout(resolve, waitMs))
              }
            }

            console.error("Failed to load skills:", lastError)
            if (isCurrentLoad()) {
              set({ skills: previousSkills, isLoading: false })
            }
            return false
          })()

          skillsLoadInFlight.set(cacheKey, request)
          try {
            return await request
          } finally {
            if (skillsLoadInFlight.get(cacheKey) === request) {
              skillsLoadInFlight.delete(cacheKey)
            }
          }
        },

        getSkillDetail: async (name: string) => {
          try {
            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(`${replacePathParams(API_ENDPOINTS.config.skill, { name })}${queryParams}`)
            if (!response.ok) {
              return null
            }

            return (await response.json()) as SkillDetail
          } catch {
            return null
          }
        },

        createSkill: async (config: SkillConfig) => {
          startConfigUpdate("Creating skill...")
          let requiresReload = false
          try {
            const skillConfig: Record<string, unknown> = {
              name: config.name,
              description: config.description,
            }

            if (config.instructions) skillConfig.instructions = config.instructions
            if (config.scope) skillConfig.scope = config.scope
            if (config.source) skillConfig.source = config.source
            if (config.supportingFiles) skillConfig.supportingFiles = config.supportingFiles

            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.skill, { name: config.name })}${queryParams}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(skillConfig),
              },
            )

            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              const message = payload?.error || "Failed to create skill"
              throw new Error(message)
            }

            const needsReload = payload?.requiresReload ?? false
            if (needsReload) {
              requiresReload = true
              await refreshSkillsAfterAxCodeRestart({
                message: payload?.message,
                delayMs: payload?.reloadDelayMs,
              })
              return true
            }

            const loaded = await get().loadSkills()
            if (loaded) {
              emitConfigChange("skills", { source: CONFIG_EVENT_SOURCE })
            }
            return loaded
          } catch {
            return false
          } finally {
            if (!requiresReload) {
              finishConfigUpdate()
            }
          }
        },

        updateSkill: async (name: string, config: Partial<SkillConfig>) => {
          startConfigUpdate("Updating skill...")
          let requiresReload = false
          try {
            const skillConfig: Record<string, unknown> = {}

            if (config.description !== undefined) skillConfig.description = config.description
            if (config.instructions !== undefined) skillConfig.instructions = config.instructions
            if (config.supportingFiles !== undefined) skillConfig.supportingFiles = config.supportingFiles
            if (config.targetPath !== undefined) skillConfig.targetPath = config.targetPath

            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(`${replacePathParams(API_ENDPOINTS.config.skill, { name })}${queryParams}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(skillConfig),
            })

            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              const message = payload?.error || "Failed to update skill"
              throw new Error(message)
            }

            const needsReload = payload?.requiresReload ?? false
            if (needsReload) {
              requiresReload = true
              await refreshSkillsAfterAxCodeRestart({
                message: payload?.message,
                delayMs: payload?.reloadDelayMs,
              })
              return true
            }

            const loaded = await get().loadSkills()
            if (loaded) {
              emitConfigChange("skills", { source: CONFIG_EVENT_SOURCE })
            }
            return loaded
          } catch {
            return false
          } finally {
            if (!requiresReload) {
              finishConfigUpdate()
            }
          }
        },

        deleteSkill: async (name: string) => {
          startConfigUpdate("Deleting skill...")
          let requiresReload = false
          try {
            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(`${replacePathParams(API_ENDPOINTS.config.skill, { name })}${queryParams}`, {
              method: "DELETE",
            })

            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              const message = payload?.error || "Failed to delete skill"
              throw new Error(message)
            }

            const needsReload = payload?.requiresReload ?? false
            if (needsReload) {
              requiresReload = true
              await refreshSkillsAfterAxCodeRestart({
                message: payload?.message,
                delayMs: payload?.reloadDelayMs,
              })
              return true
            }

            const loaded = await get().loadSkills()
            if (loaded) {
              emitConfigChange("skills", { source: CONFIG_EVENT_SOURCE })
            }

            if (get().selectedSkillName === name) {
              set({ selectedSkillName: null })
            }

            return loaded
          } catch {
            return false
          } finally {
            if (!requiresReload) {
              finishConfigUpdate()
            }
          }
        },

        getSkillByName: (name: string) => {
          const { skills } = get()
          return skills.find((s) => s.name === name)
        },

        readSupportingFile: async (skillName: string, filePath: string) => {
          try {
            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `&directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.skill, { name: skillName })}/files/${encodeURIComponent(filePath)}${queryParams}`,
            )
            if (!response.ok) {
              return null
            }

            const data = await response.json()
            return data.content ?? null
          } catch {
            return null
          }
        },

        writeSupportingFile: async (skillName: string, filePath: string, content: string) => {
          try {
            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.skill, { name: skillName })}/files/${encodeURIComponent(filePath)}${queryParams}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
              },
            )

            return response.ok
          } catch {
            return false
          }
        },

        deleteSupportingFile: async (skillName: string, filePath: string) => {
          try {
            const currentDirectory = getAxCodeCurrentDirectory()
            const queryParams = currentDirectory ? `?directory=${encodeURIComponent(currentDirectory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.skill, { name: skillName })}/files/${encodeURIComponent(filePath)}${queryParams}`,
              { method: "DELETE" },
            )

            return response.ok
          } catch {
            return false
          }
        },
      }),
      {
        name: "skills-store",
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({
          selectedSkillName: state.selectedSkillName,
        }),
      },
    ),
    {
      name: "skills-store",
    },
  ),
)

if (typeof window !== "undefined") {
  window.__zustand_skills_store__ = useSkillsStore
}

export async function refreshSkillsAfterAxCodeRestart(options?: { message?: string; delayMs?: number }) {
  try {
    updateConfigUpdateMessage(options?.message || "Refreshing skills…")
  } catch {
    // ignore
  }

  try {
    await waitForAxCodeConnection(options?.delayMs)
    updateConfigUpdateMessage("Refreshing skills…")
    const skillsStore = useSkillsStore.getState()
    const loaded = await skillsStore.loadSkills()
    if (loaded) {
      emitConfigChange("skills", { source: CONFIG_EVENT_SOURCE })
    }
  } catch {
    updateConfigUpdateMessage("AX Code refresh failed. Please retry.")
    await sleep(1500)
  } finally {
    finishConfigUpdate()
  }
}

// Subscribe to config changes from other stores
subscribeToConfigChanges((event) => {
  if (event.source === CONFIG_EVENT_SOURCE) {
    return
  }

  if (scopeMatches(event, "skills")) {
    const { loadSkills } = useSkillsStore.getState()
    void loadSkills()
  }
})
