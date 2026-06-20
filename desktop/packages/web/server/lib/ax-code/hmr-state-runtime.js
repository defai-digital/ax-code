export const createHmrStateRuntime = (dependencies) => {
  const {
    globalThisLike,
    os,
    processLike,
    stateKey,
  } = dependencies;

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
      };
    }
    return globalThisLike[stateKey];
  };

  const ensureUserProvidedAxCodePassword = (hmrState) => {
    if (typeof hmrState.userProvidedAxCodePassword !== 'undefined') {
      return;
    }
    const initialPassword = typeof processLike.env.AX_CODE_SERVER_PASSWORD === 'string'
      ? processLike.env.AX_CODE_SERVER_PASSWORD.trim()
      : '';
    hmrState.userProvidedAxCodePassword = initialPassword || null;
  };

  const getUserProvidedAxCodePassword = (hmrState) => (
    typeof hmrState.userProvidedAxCodePassword === 'string' && hmrState.userProvidedAxCodePassword.length > 0
      ? hmrState.userProvidedAxCodePassword
      : null
  );

  const resolveAxCodeAuthFromState = ({ hmrState, userProvidedAxCodePassword }) => ({
    axCodeAuthPassword:
      typeof hmrState.axCodeAuthPassword === 'string' && hmrState.axCodeAuthPassword.length > 0
        ? hmrState.axCodeAuthPassword
        : userProvidedAxCodePassword,
    axCodeAuthSource:
      typeof hmrState.axCodeAuthSource === 'string' && hmrState.axCodeAuthSource.length > 0
        ? hmrState.axCodeAuthSource
        : (userProvidedAxCodePassword ? 'user-env' : null),
  });

  const syncStateFromRuntime = (hmrState, runtime) => {
    hmrState.axCodeProcess = runtime.axCodeProcess;
    hmrState.axCodePort = runtime.axCodePort;
    hmrState.axCodeBaseUrl = runtime.axCodeBaseUrl;
    hmrState.isShuttingDown = runtime.isShuttingDown;
    hmrState.signalsAttached = runtime.signalsAttached;
    hmrState.axCodeWorkingDirectory = runtime.axCodeWorkingDirectory;
    hmrState.axCodeAuthPassword = runtime.axCodeAuthPassword;
    hmrState.axCodeAuthSource = runtime.axCodeAuthSource;
  };

  const restoreRuntimeFromState = ({ hmrState, userProvidedAxCodePassword }) => {
    const auth = resolveAxCodeAuthFromState({ hmrState, userProvidedAxCodePassword });
    return {
      axCodeProcess: hmrState.axCodeProcess,
      axCodePort: hmrState.axCodePort,
      axCodeBaseUrl: hmrState.axCodeBaseUrl ?? null,
      isShuttingDown: hmrState.isShuttingDown,
      signalsAttached: hmrState.signalsAttached,
      axCodeWorkingDirectory: hmrState.axCodeWorkingDirectory,
      axCodeAuthPassword: auth.axCodeAuthPassword,
      axCodeAuthSource: auth.axCodeAuthSource,
    };
  };

  return {
    getOrCreateHmrState,
    ensureUserProvidedAxCodePassword,
    getUserProvidedAxCodePassword,
    resolveAxCodeAuthFromState,
    syncStateFromRuntime,
    restoreRuntimeFromState,
  };
};
