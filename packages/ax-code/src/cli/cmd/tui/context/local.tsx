import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import path from "path"
import { Global } from "@/global"
import { iife } from "@/util/iife"
import { createSimpleContext } from "./helper"
import { useToast } from "../ui/toast"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import {
  providerModelEquals,
  providerModelKey,
  providerModelList,
  type ProviderModelKeyInput,
} from "@/provider/model-key"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { useRoute } from "./route"
import { RGBA } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import {
  modelIdentity,
  normalizeModelVariantStore,
  normalizeRecentModels,
  pruneModelPreferences,
  rememberRecentModel as rememberRecentModelEntry,
  resolveCurrentAgent,
} from "./local-util"
import { Log } from "@/util/log"
import { modelDisplayInfo } from "@tui/component/model-vision-label"
import { modelSelectableForProvider } from "@/provider/model-selectability"

const log = Log.create({ service: "tui.local" })

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const provider = sync.data.provider.find((x) => x.id === model.providerID)
      return modelSelectableForProvider(model.providerID, provider?.models[model.modelID])
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const agent = iife(() => {
      const coreAgents = createMemo(() => sync.data.agent.filter((x) => Agent.resolveTier(x) === "core"))
      const agents = createMemo(() =>
        sync.data.agent.filter((x) => {
          const t = Agent.resolveTier(x)
          return t === "core" || t === "specialist"
        }),
      )
      const visibleAgents = createMemo(() => sync.data.agent.filter((x) => Agent.resolveTier(x) !== "internal"))
      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: agents()[0]?.name ?? "",
      })
      const { theme } = useTheme()
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
        theme.info,
      ])
      return {
        list() {
          return agents()
        },
        current() {
          return resolveCurrentAgent(agents(), agentStore.current)
        },
        set(name: string) {
          if (agents().length === 0) {
            setAgentStore("current", name)
            return
          }
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const list = coreAgents()
            if (list.length === 0) return
            // Use the resolved current name so cycling stays in sync with what
            // the user sees — `agentStore.current` may be empty before sync data
            // loads, or hold a specialist name (not in `list`).
            const currentName = resolveCurrentAgent(agents(), agentStore.current).name
            const idx = list.findIndex((x) => x.name === currentName)
            let next = idx === -1 ? (direction === 1 ? 0 : list.length - 1) : idx + direction
            if (next < 0) next = list.length - 1
            if (next >= list.length) next = 0
            const value = list[next]
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const index = visibleAgents().findIndex((x) => x.name === name)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) {
            const color = agent.color
            if (color.startsWith("#")) return RGBA.fromHex(color)
            // already validated by config, just satisfying TS here
            return theme[color as keyof typeof theme] as RGBA
          }
          return colors()[index % colors().length]
        },
        icon(name: string) {
          const icons: Record<string, string> = {
            build: "\uD83E\uDD16",
            plan: "\uD83D\uDCCB",
            general: "\uD83D\uDCAC",
            explore: "\uD83D\uDD0D",
            react: "\uD83E\uDDE0",
            security: "\uD83D\uDEE1\uFE0F",
            architect: "\uD83C\uDFD7\uFE0F",
            debug: "\uD83D\uDC1B",
            perf: "\u26A1",
            devops: "\uD83D\uDE80",
            test: "\uD83E\uDDEA",
          }
          return icons[name] ?? "\uD83D\uDCAC"
        },
      }
    })

    const model = iife(() => {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        model: Record<
          string,
          {
            providerID: string
            modelID: string
          }
        >
        recent: {
          providerID: string
          modelID: string
        }[]
        favorite: {
          providerID: string
          modelID: string
        }[]
        variant: Record<string, string | undefined>
      }>({
        ready: false,
        model: {},
        recent: [],
        favorite: [],
        variant: {},
      })

      const filePath = path.join(Global.Path.state, "model.json")
      const state = {
        pending: false,
        saveWarningShown: false,
      }

      function rememberRecentModel(model: ProviderModelKeyInput) {
        setModelStore("recent", rememberRecentModelEntry(modelStore.recent, model))
      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void Filesystem.writeJson(filePath, {
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          variant: modelStore.variant,
        })
          .then(() => {
            state.saveWarningShown = false
          })
          .catch((error) => {
            state.pending = true
            if (state.saveWarningShown) return
            state.saveWarningShown = true
            log.warn("failed to persist local model preferences", { filePath, error })
            if (!shouldSurfaceOptionalStateError(error)) return
            toast.show({
              message: optionalStateErrorMessage(error, "Failed to save model preferences"),
              variant: "warning",
              duration: 3000,
            })
          })
      }

      Filesystem.readJson(filePath)
        .then((x: any) => {
          setModelStore("recent", normalizeRecentModels(x?.recent))
          setModelStore("favorite", providerModelList(x?.favorite))
          setModelStore("variant", normalizeModelVariantStore(x?.variant))
        })
        .catch((error) => {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return
          log.warn("failed to load local model preferences", { filePath, error })
          if (shouldSurfaceOptionalStateError(error)) {
            toast.show({
              message: optionalStateErrorMessage(error, "Failed to load model preferences"),
              variant: "warning",
              duration: 3000,
            })
          }
        })
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      const args = useArgs()
      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = Provider.parseModel(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        if (sync.data.config.model) {
          const { providerID, modelID } = Provider.parseModel(sync.data.config.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of modelStore.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const provider = sync.data.provider[0]
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const defaultInfo = defaultModel ? provider.models[defaultModel] : undefined
        const firstModel = Object.values(provider.models).find((item) => modelSelectableForProvider(provider.id, item))
        const model = modelSelectableForProvider(provider.id, defaultInfo) ? defaultModel : firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
      })

      const currentModel = createMemo(() => {
        const a = agent.current()
        return (
          getFirstValidModel(
            () => modelStore.model[a.name],
            () => a.model,
            fallbackModel,
          ) ?? undefined
        )
      })

      // Re-validate per-agent model overrides when providers finish loading.
      // Models set before `provider_loaded` were stored without validation;
      // this clears any that turned out to be invalid once provider data arrives.
      createEffect(() => {
        if (!sync.data.provider_loaded) return
        for (const [agentName, storedModel] of Object.entries(modelStore.model)) {
          if (!storedModel) continue
          if (!isModelValid(storedModel)) {
            log.info("removing invalid model override after providers loaded", {
              agentName,
              providerID: storedModel.providerID,
              modelID: storedModel.modelID,
            })
            setModelStore("model", (prev) => {
              const next = { ...prev }
              delete next[agentName]
              return next
            })
          }
        }
        const pruned = pruneModelPreferences(
          {
            recent: modelStore.recent,
            favorite: modelStore.favorite,
            variant: modelStore.variant,
          },
          isModelValid,
        )
        if (pruned.changed) {
          log.info("removing invalid stored model preferences after providers loaded", {
            recentBefore: modelStore.recent.length,
            recentAfter: pruned.recent.length,
            favoriteBefore: modelStore.favorite.length,
            favoriteAfter: pruned.favorite.length,
          })
          setModelStore("recent", pruned.recent)
          setModelStore("favorite", pruned.favorite)
          setModelStore("variant", pruned.variant)
          save()
        }
      })

      return {
        current: currentModel,
        hasOverride(name: string) {
          return !!modelStore.model[name]
        },
        get ready() {
          return modelStore.ready
        },
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
              vision: false,
            }
          }
          const provider = sync.data.provider.find((x) => x.id === value.providerID)
          const info = provider?.models[value.modelID]
          const display = modelDisplayInfo(value.modelID, info)
          return {
            provider: provider?.name ?? value.providerID,
            model: display.label,
            reasoning: info?.capabilities?.reasoning ?? false,
            vision: display.vision,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = modelStore.recent.filter((item) => isModelValid(item))
          const index = recent.findIndex((x) => providerModelEquals(x, current))
          if (index === -1) return
          let next = index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          setModelStore("model", agent.current().name, { ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => providerModelEquals(x, current))
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          setModelStore("model", agent.current().name, { ...next })
          rememberRecentModel(next)
          save()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            const currentAgentName = agent.current().name
            // When providers haven't loaded yet, skip validation but still persist
            // the selection so the user's choice is remembered after startup.
            if (!sync.data.provider_loaded) {
              setModelStore("model", currentAgentName, model)
              if (options?.recent) {
                rememberRecentModel(model)
              }
              save()
              return
            }
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${providerModelKey(model)} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            setModelStore("model", currentAgentName, model)
            if (options?.recent) {
              rememberRecentModel(model)
              save()
            }
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${providerModelKey(model)} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const exists = modelStore.favorite.some((x) => providerModelEquals(x, model))
            const next = exists
              ? modelStore.favorite.filter((x) => !providerModelEquals(x, model))
              : [model, ...modelStore.favorite]
            setModelStore("favorite", next.map(modelIdentity))
            save()
          })
        },
        variant: {
          current() {
            const m = currentModel()
            if (!m) return undefined
            const key = providerModelKey(m)
            return modelStore.variant[key]
          },
          list() {
            const m = currentModel()
            if (!m) return []
            const provider = sync.data.provider.find((x) => x.id === m.providerID)
            const info = provider?.models[m.modelID]
            if (!info?.variants) return []
            return Object.keys(info.variants)
          },
          set(value: string | undefined) {
            const m = currentModel()
            if (!m) return
            const key = providerModelKey(m)
            setModelStore("variant", key, value)
            save()
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const current = this.current()
            if (!current) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    })

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    const session = iife(() => {
      const filePath = path.join(Global.Path.state, "session.json")
      const [sessionStore, setSessionStore] = createStore<{ ready: boolean; pinned: string[] }>({
        ready: false,
        pinned: [],
      })
      const state = { pending: false, saveWarningShown: false, disposed: false }

      onCleanup(() => {
        state.disposed = true
      })

      function save() {
        if (state.disposed) return
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void Filesystem.writeJson(filePath, { pinned: sessionStore.pinned })
          .then(() => {
            state.saveWarningShown = false
          })
          .catch((error) => {
            state.pending = true
            if (state.saveWarningShown) return
            state.saveWarningShown = true
            log.warn("failed to persist session pin state", { filePath, error })
          })
      }

      Filesystem.readJson(filePath)
        .then((x: any) => {
          if (Array.isArray(x?.pinned)) setSessionStore("pinned", x.pinned)
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const slots = createMemo(() => {
        const existing = new Set(sync.data.session.filter((x) => x.parentID === undefined).map((x) => x.id))
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      const route = useRoute()

      return {
        pinned() {
          return sessionStore.pinned
        },
        slots() {
          return slots()
        },
        isPinned(id: string) {
          return sessionStore.pinned.includes(id)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    })

    // Automatically update model when agent changes
    createEffect(() => {
      const value = agent.current()
      if (!value.model) return
      if (!isModelValid(value.model)) {
        toast.show({
          variant: "warning",
          message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
          duration: 3000,
        })
        return
      }
      // Only seed the per-agent slot when the user has no override yet.
      // Otherwise switching away and back to this agent would wipe their
      // manual model choice with the config-pinned default. `currentModel`
      // already falls back to `a.model` for display when the slot is empty.
      if (model.hasOverride(value.name)) return
      model.set({
        providerID: value.model.providerID,
        modelID: value.model.modelID,
      })
    })

    const result = {
      model,
      agent,
      mcp,
      session,
    }
    return result
  },
})
