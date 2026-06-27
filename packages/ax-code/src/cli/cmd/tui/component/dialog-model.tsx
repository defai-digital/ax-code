import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./provider-state"
import { modelDisplayInfo } from "./model-vision-label"
import { CLI_PROVIDERS, providerModelSelectable } from "./dialog-provider-options"
import { modelMemoryBlockReason } from "@/provider/model-selectability"
import { useTheme } from "../context/theme"
import { dialogModelOptionDisabled } from "./dialog-model-options"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        const display = modelDisplayInfo(item.modelID, model)
        const blockReason = modelMemoryBlockReason(provider.id, model)
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: display.label,
            searchText: display.searchText,
            description: blockReason ?? provider.name,
            descriptionFg: blockReason ? theme.warning : undefined,
            category,
            disabled: dialogModelOptionDisabled(provider.id, model.id, model),
            onSelect: () => {
              dialog.clear()
              local.model.set({ providerID: provider.id, modelID: model.id }, { recent: true })
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) =>
            providerModelSelectable({ providerID: provider.id, toolcall: info.capabilities.toolcall }),
          ),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const display = modelDisplayInfo(model, info)
            const blockReason = modelMemoryBlockReason(provider.id, info)
            return {
              value: { providerID: provider.id, modelID: model },
              title: display.label,
              searchText: display.searchText,
              description:
                blockReason ??
                (favorites.some((item) => item.providerID === provider.id && item.modelID === model)
                  ? "(Favorite)"
                  : undefined),
              descriptionFg: blockReason ? theme.warning : undefined,
              category: connected() ? provider.name : undefined,
              disabled: dialogModelOptionDisabled(provider.id, model, info),
              onSelect() {
                dialog.clear()
                local.model.set({ providerID: provider.id, modelID: model }, { recent: true })
              },
            }
          }),
          filter((x) => {
            if (!showSections) return true
            if (favorites.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            if (recents.some((item) => item.providerID === x.value.providerID && item.modelID === x.value.modelID))
              return false
            return true
          }),
          sortBy((x) => x.title),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Connect a provider",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...fuzzysort.go(needle, providerOptions, { keys: ["searchText", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => provider()?.name ?? "Select model")

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}
