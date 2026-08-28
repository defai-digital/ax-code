import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
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
import { RGBA } from "@ax-code/tui"
import { Filesystem } from "@/util/filesystem"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import {
  applyExplicitModelPreference,
  hasSessionModelPreference,
  modelIdentity,
  modelPreferenceStatus as resolveModelPreferenceStatus,
  normalizeModelOverrides,
  normalizeSessionModelPreferences,
  normalizeModelVariantStore,
  normalizeRecentModels,
  pruneModelPreferences,
  pruneSessionModelPreferences,
  rememberSessionModelPreference,
  resolvePinnedModelPreference,
  sessionModelPreference,
  solidStoreRecordPatch,
  rememberRecentModel as rememberRecentModelEntry,
  resolveCurrentAgent,
  type ModelPreferenceStatus,
  type SessionModelPreferenceStore,
} from "./local-util"
import { Log } from "@/util/log"
import { modelDisplayInfo } from "@tui/component/model-vision-label"
import { modelSelectableForProvider } from "@/provider/model-selectability"
import { readOptionalJsonState } from "@tui/util/optional-json-state"

const log = Log.create({ service: "tui.local" })

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()

    function modelPreferenceStatus(model: { providerID: string; modelID: string }): ModelPreferenceStatus {
      return resolveModelPreferenceStatus(sync.data.provider, model)
    }

    function isModelValid(model: { providerID: string; modelID: string }) {
      return modelPreferenceStatus(model) === "valid"
    }

    // Config / agent pins outlive provider changes: follow them to the same
    // SKU on a connected provider instead of silently dropping the pin.
    function resolvePin(model: { providerID: string; modelID: string } | undefined) {
      if (!model) return undefined
      return resolvePinnedModelPreference(sync.data.provider, model)
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
      const [sessionModels, setSessionModels] = createSignal<SessionModelPreferenceStore>({})
      const route = useRoute()

      const filePath = path.join(Global.Path.state, "model.json")
      const state = {
        pending: false,
        saveWarningShown: false,
        persistenceBlocked: false,
      }

      function rememberRecentModel(model: ProviderModelKeyInput) {
        setModelStore("recent", rememberRecentModelEntry(modelStore.recent, model))
      }

      function activeSessionID() {
        return route.data.type === "session" ? route.data.sessionID : undefined
      }

      function rememberSessionModel(sessionID: string, model: ProviderModelKeyInput, agentName?: string) {
        const current = sessionModels()
        const next = rememberSessionModelPreference(current, sessionID, agentName, model)
        if (next === current) return false
        setSessionModels(next)
        return true
      }

      function setUserModel(agentName: string, model: ProviderModelKeyInput) {
        const applied = applyExplicitModelPreference(
          sessionModels(),
          modelStore.model,
          activeSessionID(),
          agentName,
          model,
        )
        if (applied.sessions !== sessionModels()) setSessionModels(applied.sessions)
        if (applied.global !== modelStore.model) {
          setModelStore("model", solidStoreRecordPatch(modelStore.model, applied.global))
        }
      }

      function variantPreferenceStatus(
        model: ProviderModelKeyInput,
        variant: string | undefined,
      ): ModelPreferenceStatus {
        const status = modelPreferenceStatus(model)
        if (status !== "valid") return status
        if (variant === undefined) return "valid"
        const provider = sync.data.provider.find((x) => x.id === model.providerID)
        const variants = provider?.models[model.modelID]?.variants
        return variants && Object.hasOwn(variants, variant) ? "valid" : "invalid"
      }

      function isVariantValid(model: ProviderModelKeyInput, variant: string | undefined) {
        return variantPreferenceStatus(model, variant) === "valid"
      }

      function save() {
        if (state.persistenceBlocked) {
          state.pending = true
          return
        }
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void Filesystem.writeJson(filePath, {
          model: modelStore.model,
          session: sessionModels(),
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

      readOptionalJsonState<any>(filePath)
        .then((result) => {
          if (result.status === "missing") return
          if (result.status === "invalid") {
            state.persistenceBlocked = true
            log.warn("failed to load local model preferences; persistence disabled to avoid overwriting state", {
              filePath,
              error: result.error,
            })
            if (shouldSurfaceOptionalStateError(result.error)) {
              toast.show({
                message: optionalStateErrorMessage(result.error, "Failed to load model preferences"),
                variant: "warning",
                duration: 3000,
              })
            }
            return
          }
          setModelStore("model", normalizeModelOverrides(result.value?.model))
          setSessionModels(normalizeSessionModelPreferences(result.value?.session))
          setModelStore("recent", normalizeRecentModels(result.value?.recent))
          setModelStore("favorite", providerModelList(result.value?.favorite))
          setModelStore("variant", normalizeModelVariantStore(result.value?.variant))
        })
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      const args = useArgs()
      const fallbackModel = createMemo(() => {
        if (args.model) {
          const requested = resolvePin(Provider.parseModel(args.model))
          if (requested) return requested
        }

        if (sync.data.config.model) {
          const configured = resolvePin(Provider.parseModel(sync.data.config.model))
          if (configured) return configured
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
        const sessionID = activeSessionID()
        return (
          getFirstValidModel(
            () => resolvePin(sessionModelPreference(sessionModels(), sessionID, a.name)),
            () => resolvePin(modelStore.model[a.name]),
            () => resolvePin(a.model),
            fallbackModel,
          ) ?? undefined
        )
      })

      // Re-validate stored model preferences when providers finish loading.
      // Models set before `provider_loaded` were stored without validation;
      // this clears any that turned out to be invalid once provider data arrives.
      createEffect(() => {
        if (!sync.data.provider_loaded) return
        const pruned = pruneModelPreferences(
          {
            model: modelStore.model,
            recent: modelStore.recent,
            favorite: modelStore.favorite,
            variant: modelStore.variant,
          },
          modelPreferenceStatus,
          variantPreferenceStatus,
          resolvePin,
        )
        const prunedSessions = pruneSessionModelPreferences(sessionModels(), modelPreferenceStatus, resolvePin)
        if (pruned.changed || prunedSessions.changed) {
          for (const agentName of Object.keys(modelStore.model)) {
            if (Object.hasOwn(pruned.model, agentName)) continue
            const storedModel = modelStore.model[agentName]
            log.info("removing invalid model override after providers loaded", {
              agentName,
              providerID: storedModel?.providerID,
              modelID: storedModel?.modelID,
            })
          }
          log.info("removing invalid stored model preferences after providers loaded", {
            modelBefore: Object.keys(modelStore.model).length,
            modelAfter: Object.keys(pruned.model).length,
            recentBefore: modelStore.recent.length,
            recentAfter: pruned.recent.length,
            favoriteBefore: modelStore.favorite.length,
            favoriteAfter: pruned.favorite.length,
            sessionBefore: Object.keys(sessionModels()).length,
            sessionAfter: Object.keys(prunedSessions.value).length,
          })
          setModelStore("model", solidStoreRecordPatch(modelStore.model, pruned.model))
          setSessionModels(prunedSessions.value)
          setModelStore("recent", pruned.recent)
          setModelStore("favorite", pruned.favorite)
          setModelStore("variant", solidStoreRecordPatch(modelStore.variant, pruned.variant))
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
          setUserModel(agent.current().name, val)
          save()
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
          setUserModel(agent.current().name, next)
          rememberRecentModel(next)
          save()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            const currentAgentName = agent.current().name
            // When providers haven't loaded yet, skip validation but still persist
            // the selection so the user's choice is remembered after startup.
            if (!sync.data.provider_loaded) {
              setUserModel(currentAgentName, model)
              if (options?.recent) {
                rememberRecentModel(model)
              }
              save()
              return
            }
            // `--model deepseek/…` and a stored native pin must follow the SKU
            // onto a connected gateway, the same way `ax-code run --model` does.
            const resolved = isModelValid(model) ? model : resolvePin(model)
            if (!resolved) {
              toast.show({
                message: `Model ${providerModelKey(model)} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            setUserModel(currentAgentName, resolved)
            if (options?.recent) {
              rememberRecentModel(resolved)
            }
            save()
          })
        },
        session: {
          set(sessionID: string, model: ProviderModelKeyInput, agentName?: string) {
            if (!rememberSessionModel(sessionID, model, agentName)) return
            save()
          },
          has(sessionID: string) {
            return hasSessionModelPreference(sessionModels(), sessionID)
          },
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
            const value = modelStore.variant[key]
            return isVariantValid(m, value) ? value : undefined
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
          cycle(): string | undefined {
            const variants = this.list()
            if (variants.length === 0) return this.current()
            const current = this.current()
            if (!current) {
              const next = variants[0]
              this.set(next)
              return next
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return undefined
            }
            const next = variants[index + 1]
            this.set(next)
            return next
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
      const state = { pending: false, saveWarningShown: false, disposed: false, persistenceBlocked: false }

      onCleanup(() => {
        state.disposed = true
      })

      function save() {
        if (state.disposed) return
        if (state.persistenceBlocked) {
          state.pending = true
          return
        }
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

      readOptionalJsonState<any>(filePath)
        .then((result) => {
          if (result.status === "missing") return
          if (result.status === "invalid") {
            state.persistenceBlocked = true
            log.warn("failed to load session pin state; persistence disabled to avoid overwriting state", {
              filePath,
              error: result.error,
            })
            return
          }
          if (Array.isArray(result.value?.pinned)) setSessionStore("pinned", result.value.pinned)
        })
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

    // Warn once when the current agent's configured model cannot be used,
    // not even as the same SKU on a connected provider. `currentModel`
    // already resolves the pin for display and submission, so the per-agent
    // override slot is left to explicit user picks: a seeded copy of the pin
    // would keep shadowing the config after the pin changes.
    let warnedAgentModel: string | undefined
    createEffect(() => {
      const value = agent.current()
      if (!value.model) return
      // Agents can land before providers during bootstrap; validating against
      // an empty provider list would toast a false "not valid" warning.
      if (!sync.data.provider_loaded) return
      const status = modelPreferenceStatus(value.model)
      if (status === "unknown") return
      if (status === "valid" || resolvePin(value.model)) return
      // Dedupe: the provider store rewrites re-run this effect; only warn
      // once per agent+model combination.
      const warnKey = `${value.name}:${value.model.providerID}/${value.model.modelID}`
      if (warnedAgentModel === warnKey) return
      warnedAgentModel = warnKey
      toast.show({
        variant: "warning",
        message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
        duration: 3000,
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
