import type { ProviderModel, ProviderWithModelList } from "@/types/providerModels"

export const getProviderModelDisabledReason = (model: Record<string, unknown> | null | undefined): string => {
  const options = model?.options
  if (!options || typeof options !== "object") return ""

  const reason = (options as Record<string, unknown>).memoryBlockReason
  return typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : ""
}

export const isProviderModelSelectable = (model: Record<string, unknown> | null | undefined): boolean =>
  getProviderModelDisabledReason(model).length === 0

export const findSelectableProviderModel = (
  providers: ProviderWithModelList[],
  providerId: string,
  modelId: string,
): ProviderModel | undefined => {
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return undefined

  const model = provider.models.find((item) => item.id === modelId)
  if (!model || !isProviderModelSelectable(model)) return undefined

  return model
}

export const hasSelectableProviderModel = (
  providers: ProviderWithModelList[],
  providerId: string,
  modelId: string,
): boolean => Boolean(findSelectableProviderModel(providers, providerId, modelId))
