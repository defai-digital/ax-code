import { getProviderModelDisabledReason } from "./providerModelAvailability"
import type { ProviderWithModelList } from "../types/providerModels"

type ModelPickerEntryLike = { model: Record<string, unknown> | null | undefined }
type FavoriteModelRef = { providerID: string; modelID: string }

export const getNextSelectableModelPickerIndex = <TEntry extends ModelPickerEntryLike>(
  entries: TEntry[],
  currentIndex: number,
  direction: 1 | -1,
  isDisabled: (entry: TEntry) => boolean = (entry) => Boolean(getProviderModelDisabledReason(entry.model)),
) => {
  const total = entries.length
  if (total === 0) return -1

  const safeCurrentIndex = currentIndex >= 0 && currentIndex < total ? currentIndex : direction === 1 ? -1 : 0
  for (let offset = 1; offset <= total; offset += 1) {
    const nextIndex = (safeCurrentIndex + direction * offset + total) % total
    const entry = entries[nextIndex]
    if (entry && !isDisabled(entry)) return nextIndex
  }

  return -1
}

export const normalizeModelPickerSelectionIndex = <TEntry extends ModelPickerEntryLike>(
  entries: TEntry[],
  currentIndex: number,
  isDisabled: (entry: TEntry) => boolean = (entry) => Boolean(getProviderModelDisabledReason(entry.model)),
) => {
  if (entries.length === 0) return -1

  const currentEntry = entries[currentIndex]
  if (currentIndex >= 0 && currentIndex < entries.length && currentEntry && !isDisabled(currentEntry)) {
    return currentIndex
  }

  return getNextSelectableModelPickerIndex(entries, -1, 1, isDisabled)
}

export const getNextSelectableFavoriteModel = (
  favoriteModels: FavoriteModelRef[],
  providers: ProviderWithModelList[],
  currentProviderId: string | undefined | null,
  currentModelId: string | undefined | null,
  direction: 1 | -1,
): FavoriteModelRef | null => {
  const favoriteEntries = favoriteModels.map((favorite) => {
    const provider = providers.find((entry) => entry.id === favorite.providerID)
    const model = provider?.models.find((entry) => entry.id === favorite.modelID)
    return { ...favorite, model: model ?? null }
  })

  const currentIndex = favoriteEntries.findIndex(
    (favorite) => favorite.providerID === currentProviderId && favorite.modelID === currentModelId,
  )
  const nextIndex = getNextSelectableModelPickerIndex(
    favoriteEntries,
    currentIndex,
    direction,
    (entry) => !entry.model || Boolean(getProviderModelDisabledReason(entry.model)),
  )
  const next = nextIndex >= 0 ? favoriteEntries[nextIndex] : undefined

  return next ? { providerID: next.providerID, modelID: next.modelID } : null
}
