export function shouldOfferSetup(input: {
  kvReady: boolean
  seen: unknown
  providerLoaded: boolean
  providerFailed: boolean
  modelReady: boolean
  sessionLoaded: boolean
  sessionCount: number
  providerCount: number
  explicitLaunch: boolean
  atHome: boolean
  dialogOpen: boolean
}) {
  return (
    input.kvReady &&
    input.seen !== true &&
    input.providerLoaded &&
    !input.providerFailed &&
    input.modelReady &&
    input.sessionLoaded &&
    input.sessionCount === 0 &&
    input.providerCount === 0 &&
    !input.explicitLaunch &&
    input.atHome &&
    !input.dialogOpen
  )
}
