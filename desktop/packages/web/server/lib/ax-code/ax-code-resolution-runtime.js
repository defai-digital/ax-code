export const createAxCodeResolutionRuntime = (dependencies) => {
  const {
    path,
    resolveAxCodeCliPath,
    applyAxCodeBinaryFromSettings,
    ensureAxCodeCliEnv,
    resolveManagedAxCodeLaunchSpec,
    getResolvedState,
    setResolvedAxCodeBinarySource,
  } = dependencies;

  const getAxCodeResolutionSnapshot = async (settings) => {
    const configured = typeof settings?.axCodeBinary === 'string' ? settings.axCodeBinary : null;

    const { resolvedAxCodeBinarySource: previousSource } = getResolvedState();
    const detectedNow = resolveAxCodeCliPath();
    const { resolvedAxCodeBinarySource: rawDetectedSourceNow } = getResolvedState();
    setResolvedAxCodeBinarySource(previousSource);

    await applyAxCodeBinaryFromSettings();
    ensureAxCodeCliEnv();

    const {
      resolvedAxCodeBinary,
      resolvedAxCodeBinarySource,
      useWslForAxCode,
      resolvedWslBinary,
      resolvedWslAxCodePath,
      resolvedWslDistro,
      resolvedNodeBinary,
      resolvedBunBinary,
    } = getResolvedState();

    const resolved = resolvedAxCodeBinary || null;
    const source = resolvedAxCodeBinarySource || null;
    const detectedSourceNow =
      detectedNow &&
      resolved &&
      detectedNow === resolved &&
      rawDetectedSourceNow === 'env' &&
      source &&
      source !== 'env'
        ? source
        : rawDetectedSourceNow;
    const launchSpec = resolved && !useWslForAxCode
      ? resolveManagedAxCodeLaunchSpec(resolved)
      : null;

    return {
      configured,
      resolved,
      resolvedDir: resolved ? path.dirname(resolved) : null,
      source,
      detectedNow,
      detectedSourceNow,
      launchBinary: launchSpec?.binary || null,
      launchArgs: launchSpec?.args || [],
      launchWrapperType: launchSpec?.wrapperType || null,
      viaWsl: useWslForAxCode,
      wslBinary: resolvedWslBinary || null,
      wslPath: resolvedWslAxCodePath || null,
      wslDistro: resolvedWslDistro || null,
      node: resolvedNodeBinary || null,
      bun: resolvedBunBinary || null,
    };
  };

  return {
    getAxCodeResolutionSnapshot,
  };
};
