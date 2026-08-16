import { createEffect, createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { useKeybind } from "../context/keybind"
import fuzzysort from "fuzzysort"
import { useConnected } from "./provider-state"
import { modelDisplayInfo } from "./model-vision-label"
import { modelMemoryBlockReason, modelSelectableForProvider } from "@/provider/model-selectability"
import { useTheme } from "../context/theme"
import { dialogModelOptionDisabled } from "./dialog-model-options"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { DialogAxEngineDownload, fetchAxEngineDownloadOffer, fetchAxEngineModelAnnotations } from "./dialog-ax-engine-download"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const [query, setQuery] = createSignal("")

  // Managed AX Engine models are listed before their weights exist locally.
  // Annotate picker entries with the catalog fit state ("Not downloaded",
  // "Downloading…", …) so an unusable model is never a silent selection.
  // Fetched once per dialog open; probe failure degrades to no annotations.
  const [axEngineAnnotations, setAxEngineAnnotations] = createSignal<ReadonlyMap<string, string>>(new Map())
  let axEngineAnnotationsRequested = false
  createEffect(() => {
    if (axEngineAnnotationsRequested) return
    if (!sync.data.provider.some((provider) => provider.id === AX_ENGINE_PROVIDER_ID)) return
    axEngineAnnotationsRequested = true
    void fetchAxEngineModelAnnotations(sdk)
      .then(setAxEngineAnnotations)
      .catch(() => undefined)
  })

  function axEngineAnnotation(providerID: string, modelID: string) {
    if (providerID !== AX_ENGINE_PROVIDER_ID) return undefined
    return axEngineAnnotations().get(modelID)
  }

  function selectModel(value: { providerID: string; modelID: string }) {
    const apply = () => local.model.set(value, { recent: true })
    if (value.providerID !== AX_ENGINE_PROVIDER_ID) {
      dialog.clear()
      apply()
      return
    }
    // Managed AX Engine models are listed before their weights exist locally.
    // Offer a managed Hugging Face download instead of letting the first
    // message fail with MODEL_NOT_PREPARED. Any probe failure falls back to
    // plain selection — the offer is a convenience, never a gate.
    void fetchAxEngineDownloadOffer(sdk, value.modelID)
      .then((offer) => {
        if (!offer) {
          dialog.clear()
          apply()
          return
        }
        dialog.replace(() => (
          <DialogAxEngineDownload offer={offer} sdk={sdk} toast={toast} onApplySelection={apply} />
        ))
      })
      .catch(() => {
        dialog.clear()
        apply()
      })
  }

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
        const blockReason = modelMemoryBlockReason(provider.id, model) ?? axEngineAnnotation(provider.id, model.id)
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
              selectModel({ providerID: provider.id, modelID: model.id })
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
      sortBy((provider) => provider.name),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => modelSelectableForProvider(provider.id, info)),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const display = modelDisplayInfo(model, info)
            const blockReason = modelMemoryBlockReason(provider.id, info) ?? axEngineAnnotation(provider.id, model)
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
                selectModel({ providerID: provider.id, modelID: model })
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
