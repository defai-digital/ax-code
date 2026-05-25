export type ProviderModelKeyInput = {
  providerID: string
  modelID: string
}

export function providerModelKey(input: ProviderModelKeyInput) {
  return `${input.providerID}/${input.modelID}`
}
