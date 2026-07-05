import { create } from "zustand"
import { devtools, persist, createJSONStorage } from "zustand/middleware"
import { axCodeClient } from "@/lib/ax-code/client"
import { startConfigUpdate, finishConfigUpdate, updateConfigUpdateMessage } from "@/lib/configUpdate"
import { emitConfigChange, scopeMatches, subscribeToConfigChanges } from "@/lib/configSync"
import { getSafeStorage } from "./utils/safeStorage"
import { sleep, waitForAxCodeConnection } from "./utils/axCodeConnection"
import { API_ENDPOINTS, replacePathParams } from "@/lib/http"
import { streamDebugEnabled } from "@/stores/utils/streamDebug"
import { getActiveConfigDirectory } from "@/stores/utils/configDirectory"
import { getDirectoryCacheKey } from "@/stores/utils/cacheKey"

export type CommandScope = "user" | "project"

export interface CommandConfig {
  name: string
  description?: string
  agent?: string | null
  model?: string | null
  source?: string
  template?: string
  scope?: CommandScope
}

export interface Command extends CommandConfig {
  isBuiltIn?: boolean
}

// Built-in commands provided by ax-code (not defined in user config directories)
const BUILTIN_COMMAND_NAMES = new Set(["init", "review"])

export const isCommandBuiltIn = (command: Command): boolean => {
  return BUILTIN_COMMAND_NAMES.has(command.name)
}

const CONFIG_EVENT_SOURCE = "useCommandsStore"
const COMMANDS_LOAD_CACHE_TTL_MS = 5000
const commandsLastLoadedAt = new Map<string, number>()
const commandsLoadInFlight = new Map<string, Promise<boolean>>()
const commandsLoadRequestIds = new Map<string, number>()
let commandsLoadSequence = 0

const buildCommandsSignature = (commands: Command[]): string => {
  return commands
    .map((command) =>
      [
        command.name,
        command.scope ?? "",
        command.description ?? "",
        command.agent ?? "",
        command.model ?? "",
        String(command.isBuiltIn === true),
      ].join("|"),
    )
    .join("||")
}

export interface CommandDraft {
  name: string
  scope: CommandScope
  description?: string
  agent?: string | null
  model?: string | null
  template?: string
}

interface CommandsStore {
  selectedCommandName: string | null
  commands: Command[]
  isLoading: boolean
  commandDraft: CommandDraft | null

  setSelectedCommand: (name: string | null) => void
  setCommandDraft: (draft: CommandDraft | null) => void
  loadCommands: () => Promise<boolean>
  createCommand: (config: CommandConfig) => Promise<boolean>
  updateCommand: (name: string, config: Partial<CommandConfig>) => Promise<boolean>
  deleteCommand: (name: string) => Promise<boolean>
  getCommandByName: (name: string) => Command | undefined
}

export const useCommandsStore = create<CommandsStore>()(
  devtools(
    persist(
      (set, get) => ({
        selectedCommandName: null,
        commands: [],
        isLoading: false,
        commandDraft: null,

        setSelectedCommand: (name: string | null) => {
          set({ selectedCommandName: name })
        },

        setCommandDraft: (draft: CommandDraft | null) => {
          set({ commandDraft: draft })
        },

        loadCommands: async () => {
          const directory = getActiveConfigDirectory("CommandsStore")
          const cacheKey = getDirectoryCacheKey(directory)
          const now = Date.now()
          const loadedAt = commandsLastLoadedAt.get(cacheKey) ?? 0
          const hasCachedCommands = get().commands.length > 0

          if (hasCachedCommands && now - loadedAt < COMMANDS_LOAD_CACHE_TTL_MS) {
            return true
          }

          const inFlight = commandsLoadInFlight.get(cacheKey)
          if (inFlight) {
            return inFlight
          }

          const requestId = ++commandsLoadSequence
          commandsLoadRequestIds.set(cacheKey, requestId)
          const isCurrentLoad = () =>
            commandsLoadSequence === requestId && commandsLoadRequestIds.get(cacheKey) === requestId

          const request = (async () => {
            set({ isLoading: true })
            const previousCommands = get().commands
            const previousSignature = buildCommandsSignature(previousCommands)
            let lastError: unknown = null

            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""

                // Ensure the list is scoped to the same directory we use for config source detection.
                const commands = await axCodeClient.withDirectory(directory, () =>
                  axCodeClient.listCommandsWithDetails(),
                )

                const configurableCommands = commands.filter((cmd) => cmd.source !== "skill")
                const commandsWithScope = await Promise.all(
                  configurableCommands.map(async (cmd) => {
                    try {
                      // Force no-cache
                      const response = await fetch(
                        `${replacePathParams(API_ENDPOINTS.config.command, {
                          name: cmd.name,
                        })}${queryParams}`,
                        {
                          headers: {
                            "Cache-Control": "no-cache",
                            ...(directory ? { "x-ax-code-directory": directory } : {}),
                          },
                        },
                      )

                      if (response.ok) {
                        const data = await response.json()

                        // Prioritize explicit scope
                        let scope = data.scope

                        // Fallback to deducing from sources
                        if (!scope && data.sources) {
                          const sources = data.sources
                          scope =
                            (sources.md?.exists ? sources.md.scope : undefined) ??
                            (sources.json?.exists ? sources.json.scope : undefined) ??
                            sources.md?.scope ??
                            sources.json?.scope
                        }

                        if (scope === "project" || scope === "user") {
                          return { ...cmd, scope: scope as CommandScope }
                        }

                        // Explicitly set null scope if not found
                        return { ...cmd, scope: undefined }
                      }
                    } catch (err) {
                      console.warn(`[CommandsStore] Failed to fetch config for command ${cmd.name}:`, err)
                    }
                    return cmd
                  }),
                )

                if (!isCurrentLoad()) return true
                const nextSignature = buildCommandsSignature(commandsWithScope)
                if (previousSignature !== nextSignature) {
                  set({ commands: commandsWithScope, isLoading: false })
                } else {
                  set({ isLoading: false })
                }
                commandsLastLoadedAt.set(cacheKey, Date.now())
                return true
              } catch (error) {
                lastError = error
                const waitMs = 200 * (attempt + 1)
                await new Promise((resolve) => setTimeout(resolve, waitMs))
              }
            }

            console.error("Failed to load commands:", lastError)
            if (isCurrentLoad()) {
              set({ commands: previousCommands, isLoading: false })
            }
            return false
          })()

          commandsLoadInFlight.set(cacheKey, request)
          try {
            return await request
          } finally {
            if (commandsLoadInFlight.get(cacheKey) === request) {
              commandsLoadInFlight.delete(cacheKey)
            }
          }
        },

        createCommand: async (config: CommandConfig) => {
          startConfigUpdate("Creating command configuration…")
          let requiresReload = false
          try {
            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Creating command:", config.name)
            }

            const commandConfig: Record<string, unknown> = {
              template: config.template || "",
            }

            if (config.description) commandConfig.description = config.description
            if (config.agent) commandConfig.agent = config.agent
            if (config.model) commandConfig.model = config.model
            if (config.scope) commandConfig.scope = config.scope

            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Command config to save:", commandConfig)
            }

            const directory = getActiveConfigDirectory("CommandsStore")
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.command, {
                name: config.name,
              })}${queryParams}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(directory ? { "x-ax-code-directory": directory } : {}),
                },
                body: JSON.stringify(commandConfig),
              },
            )

            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              const message = payload?.error || "Failed to create command"
              throw new Error(message)
            }

            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Command created successfully")
            }

            const needsReload = payload?.requiresReload ?? true
            if (needsReload) {
              requiresReload = true
              await performFullConfigRefresh({
                message: payload?.message,
                delayMs: payload?.reloadDelayMs,
              })
              return true
            }

            const loaded = await get().loadCommands()
            if (loaded) {
              emitConfigChange("commands", { source: CONFIG_EVENT_SOURCE })
            }
            return loaded
          } catch (error) {
            console.error("[CommandsStore] Failed to create command:", error)
            return false
          } finally {
            if (!requiresReload) {
              finishConfigUpdate()
            }
          }
        },

        updateCommand: async (name: string, config: Partial<CommandConfig>) => {
          startConfigUpdate("Updating command configuration…")
          let requiresReload = false
          try {
            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Updating command:", name)
              console.log("[CommandsStore] Config received:", config)
            }

            const commandConfig: Record<string, unknown> = {}

            if (config.description !== undefined) commandConfig.description = config.description
            if (config.agent !== undefined) commandConfig.agent = config.agent
            if (config.model !== undefined) commandConfig.model = config.model
            if (config.template !== undefined) commandConfig.template = config.template

            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Command config to update:", commandConfig)
            }

            const directory = getActiveConfigDirectory("CommandsStore")
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.command, {
                name,
              })}${queryParams}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  ...(directory ? { "x-ax-code-directory": directory } : {}),
                },
                body: JSON.stringify(commandConfig),
              },
            )

            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              const message = payload?.error || "Failed to update command"
              throw new Error(message)
            }

            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Command updated successfully")
            }

            const needsReload = payload?.requiresReload ?? true
            if (needsReload) {
              requiresReload = true
              await performFullConfigRefresh({
                message: payload?.message,
                delayMs: payload?.reloadDelayMs,
              })
              return true
            }

            const loaded = await get().loadCommands()
            if (loaded) {
              emitConfigChange("commands", { source: CONFIG_EVENT_SOURCE })
            }
            return loaded
          } catch (error) {
            console.error("[CommandsStore] Failed to update command:", error)
            return false
          } finally {
            if (!requiresReload) {
              finishConfigUpdate()
            }
          }
        },

        deleteCommand: async (name: string) => {
          startConfigUpdate("Deleting command configuration…")
          let requiresReload = false
          try {
            const directory = getActiveConfigDirectory("CommandsStore")
            const queryParams = directory ? `?directory=${encodeURIComponent(directory)}` : ""

            const response = await fetch(
              `${replacePathParams(API_ENDPOINTS.config.command, {
                name,
              })}${queryParams}`,
              {
                method: "DELETE",
                headers: directory ? { "x-ax-code-directory": directory } : undefined,
              },
            )

            const payload = await response.json().catch(() => null)
            if (!response.ok) {
              const message = payload?.error || "Failed to delete command"
              throw new Error(message)
            }

            if (streamDebugEnabled()) {
              console.log("[CommandsStore] Command deleted successfully")
            }

            const needsReload = payload?.requiresReload ?? true
            if (needsReload) {
              requiresReload = true
              await performFullConfigRefresh({
                message: payload?.message,
                delayMs: payload?.reloadDelayMs,
              })
              return true
            }

            const loaded = await get().loadCommands()
            if (loaded) {
              emitConfigChange("commands", { source: CONFIG_EVENT_SOURCE })
            }

            if (get().selectedCommandName === name) {
              set({ selectedCommandName: null })
            }

            return loaded
          } catch (error) {
            console.error("Failed to delete command:", error)
            return false
          } finally {
            if (!requiresReload) {
              finishConfigUpdate()
            }
          }
        },

        getCommandByName: (name: string) => {
          const { commands } = get()
          return commands.find((c) => c.name === name)
        },
      }),
      {
        name: "commands-store",
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({
          selectedCommandName: state.selectedCommandName,
        }),
      },
    ),
    {
      name: "commands-store",
    },
  ),
)

if (typeof window !== "undefined") {
  window.__zustand_commands_store__ = useCommandsStore
}

async function performFullConfigRefresh(options: { message?: string; delayMs?: number } = {}) {
  const { message, delayMs } = options

  try {
    updateConfigUpdateMessage(message || "Refreshing commands…")
  } catch {
    // ignore
  }

  try {
    await waitForAxCodeConnection(delayMs)
    updateConfigUpdateMessage("Refreshing commands…")

    const commandsStore = useCommandsStore.getState()

    await commandsStore.loadCommands()

    emitConfigChange("commands", { source: CONFIG_EVENT_SOURCE })
  } catch (error) {
    console.error("[CommandsStore] Failed to refresh configuration after AX Code restart:", error)
    updateConfigUpdateMessage("AX Code refresh failed. Please retry refreshing configuration manually.")
    await sleep(1500)
  } finally {
    finishConfigUpdate()
  }
}

export async function reloadAxCodeConfiguration(options?: { message?: string; delayMs?: number }) {
  startConfigUpdate(options?.message || "Reloading AX Code configuration…")

  try {
    const response = await fetch(API_ENDPOINTS.config.reload, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const message = payload?.error || "Failed to reload configuration"
      throw new Error(message)
    }

    if (payload?.requiresReload) {
      await performFullConfigRefresh({
        message: payload.message,
        delayMs: payload.reloadDelayMs,
      })
    } else {
      await performFullConfigRefresh(options)
    }
  } catch (error) {
    console.error("[reloadAxCodeConfiguration] Failed:", error)
    updateConfigUpdateMessage("Failed to reload configuration. Please try again.")
    await sleep(2000)
    finishConfigUpdate()
    throw error
  }
}

let unsubscribeCommandsConfigChanges: (() => void) | null = null

if (!unsubscribeCommandsConfigChanges) {
  unsubscribeCommandsConfigChanges = subscribeToConfigChanges((event) => {
    if (event.source === CONFIG_EVENT_SOURCE) {
      return
    }

    if (scopeMatches(event, "commands")) {
      const { loadCommands } = useCommandsStore.getState()
      void loadCommands()
    }
  })
}
