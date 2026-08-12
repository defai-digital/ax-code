import { connectPrivateGpu, privateGpuProviderConfig, type PrivateGpuConnection } from "../private-gpu/connect"
import { requirePrivateGpuVendor } from "../private-gpu/presets"
import { ALIBABA_PAI_DISPLAY_NAME, ALIBABA_PAI_PROVIDER_ID } from "./constants"

const vendor = requirePrivateGpuVendor(ALIBABA_PAI_PROVIDER_ID)

export type AlibabaPaiConnection = Omit<PrivateGpuConnection, "providerID">

export function alibabaPaiProviderConfig(input: { baseURL: string; name?: string }) {
  const config = privateGpuProviderConfig(vendor, input.baseURL)
  if (input.name && input.name !== ALIBABA_PAI_DISPLAY_NAME) {
    config[ALIBABA_PAI_PROVIDER_ID] = { ...config[ALIBABA_PAI_PROVIDER_ID], name: input.name }
  }
  return config
}

export async function connectAlibabaPai(input: { baseURL: string; apiKey: string }): Promise<AlibabaPaiConnection> {
  const connection = await connectPrivateGpu({
    providerID: ALIBABA_PAI_PROVIDER_ID,
    baseURL: input.baseURL,
    apiKey: input.apiKey,
  })
  return {
    baseURL: connection.baseURL,
    models: connection.models,
  }
}
