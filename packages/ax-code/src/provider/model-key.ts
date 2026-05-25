export type ProviderModelKeyInput = {
  providerID: string
  modelID: string
}

export function providerModelKey(input: ProviderModelKeyInput) {
  return `${input.providerID}/${input.modelID}`
}

export function providerModelEquals(left: ProviderModelKeyInput, right: ProviderModelKeyInput) {
  return left.providerID === right.providerID && left.modelID === right.modelID
}
