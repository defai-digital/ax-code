import type { Provider } from "@ax-code/sdk/v2"

export type ProviderModel = Provider["models"][string]
export type ProviderWithModelList = Omit<Provider, "models"> & { models: ProviderModel[] }
