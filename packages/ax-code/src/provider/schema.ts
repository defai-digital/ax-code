import { defineBrandedString, type BrandedIdentifier } from "@/id/branded"

export type ProviderID = BrandedIdentifier<"ProviderID">
export type ModelID = BrandedIdentifier<"ModelID">

const providerID = defineBrandedString("ProviderID")

export const ProviderID = {
  ...providerID,
  // Well-known providers
  axCode: providerID.make("ax-code"),
  google: providerID.make("google"),
  xai: providerID.make("xai"),
} as const

export const ModelID = defineBrandedString("ModelID")
