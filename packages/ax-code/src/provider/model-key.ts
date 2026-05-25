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

export function isProviderModelKeyInput(input: unknown): input is ProviderModelKeyInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "providerID" in input &&
    "modelID" in input &&
    typeof input.providerID === "string" &&
    input.providerID.length > 0 &&
    typeof input.modelID === "string" &&
    input.modelID.length > 0
  )
}

export function providerModelList(input: unknown): ProviderModelKeyInput[] {
  if (!Array.isArray(input)) return []
  return input.filter(isProviderModelKeyInput).map((model) => ({
    providerID: model.providerID,
    modelID: model.modelID,
  }))
}
