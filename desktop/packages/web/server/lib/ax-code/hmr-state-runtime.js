export const createHmrStateRuntime = (dependencies) => {
  const { globalThisLike, os, processLike, stateKey } = dependencies
  const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")
  const asNonEmptyString = (value) => asTrimmedString(value) || null

  const getOrCreateHmrState = () => {
    if (!globalThisLike[stateKey]) {
      globalThisLike[stateKey] = {
        axCodeProcess: null,
        axCodePort: null,
        axCodeWorkingDirectory: os.homedir(),
        isShuttingDown: false,
        signalsAttached: false,
        userProvidedAxCodePassword: undefined,
        axCodeAuthPassword: null,
        axCodeAuthSource: null,
      }
    }
    return globalThisLike[stateKey]
  }

  const ensureUserProvidedAxCodePassword = (hmrState) => {
    if (typeof hmrState.userProvidedAxCodePassword !== "undefined") {
      return
    }
    hmrState.userProvidedAxCodePassword = asNonEmptyString(processLike.env.AX_CODE_SERVER_PASSWORD)
  }

  const getUserProvidedAxCodePassword = (hmrState) => asNonEmptyString(hmrState.userProvidedAxCodePassword)

  const resolveAxCodeAuthFromState = ({ hmrState, userProvidedAxCodePassword }) => ({
    axCodeAuthPassword: asNonEmptyString(hmrState.axCodeAuthPassword) || userProvidedAxCodePassword,
    axCodeAuthSource: asNonEmptyString(hmrState.axCodeAuthSource) || (userProvidedAxCodePassword ? "user-env" : null),
  })

  const syncStateFromRuntime = (hmrState, runtime) => {
    hmrState.axCodeProcess = runtime.axCodeProcess
    hmrState.axCodePort = runtime.axCodePort
    hmrState.axCodeBaseUrl = runtime.axCodeBaseUrl
    hmrState.isShuttingDown = runtime.isShuttingDown
    hmrState.signalsAttached = runtime.signalsAttached
    hmrState.axCodeWorkingDirectory = runtime.axCodeWorkingDirectory
    hmrState.axCodeAuthPassword = runtime.axCodeAuthPassword
    hmrState.axCodeAuthSource = runtime.axCodeAuthSource
  }

  const restoreRuntimeFromState = ({ hmrState, userProvidedAxCodePassword }) => {
    const auth = resolveAxCodeAuthFromState({ hmrState, userProvidedAxCodePassword })
    return {
      axCodeProcess: hmrState.axCodeProcess,
      axCodePort: hmrState.axCodePort,
      axCodeBaseUrl: hmrState.axCodeBaseUrl ?? null,
      isShuttingDown: hmrState.isShuttingDown,
      signalsAttached: hmrState.signalsAttached,
      axCodeWorkingDirectory: hmrState.axCodeWorkingDirectory,
      axCodeAuthPassword: auth.axCodeAuthPassword,
      axCodeAuthSource: auth.axCodeAuthSource,
    }
  }

  return {
    getOrCreateHmrState,
    ensureUserProvidedAxCodePassword,
    getUserProvidedAxCodePassword,
    resolveAxCodeAuthFromState,
    syncStateFromRuntime,
    restoreRuntimeFromState,
  }
}
