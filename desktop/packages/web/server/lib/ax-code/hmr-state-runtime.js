export const createHmrStateRuntime = (dependencies) => {
  const { globalThisLike, os, processLike, stateKey, logger = console } = dependencies
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

  // The env password (user-exported, or injected by the Electron main process
  // once per app boot — SPEC-2026-08-29 S2.2) is authoritative. HMR state
  // should hold the same value captured by an earlier module load within the
  // same boot; if they disagree, prefer the env value and warn — never log
  // either password.
  const resolveAxCodeAuthFromState = ({ hmrState, userProvidedAxCodePassword }) => {
    const statePassword = asNonEmptyString(hmrState.axCodeAuthPassword)
    const stateSource = asNonEmptyString(hmrState.axCodeAuthSource)
    if (userProvidedAxCodePassword) {
      if (statePassword && statePassword !== userProvidedAxCodePassword) {
        logger.warn(
          "[ax-code] AX_CODE_SERVER_PASSWORD differs from the password held by HMR state; using the env value",
        )
      }
      return { axCodeAuthPassword: userProvidedAxCodePassword, axCodeAuthSource: "user-env" }
    }
    return { axCodeAuthPassword: statePassword, axCodeAuthSource: stateSource }
  }

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
