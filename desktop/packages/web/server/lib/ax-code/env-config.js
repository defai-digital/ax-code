export const resolveAxCodeEnvConfig = (options = {}) => {
  const env = options.env && typeof options.env === 'object' ? options.env : {};
  const logger = options.logger ?? console;

  const configuredAxCodePort = (() => {
    const raw =
      env.AX_CODE_PORT ||
      env.AX_CODE_DESKTOP_INTERNAL_PORT ||
      env.AX_CODE_PORT_LEGACY;
    if (!raw) {
      return null;
    }
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  const configuredAxCodeHost = (() => {
    const raw = typeof env.AX_CODE_HOST === 'string' ? env.AX_CODE_HOST.trim()
      : '';
    if (!raw) return null;

    const warnInvalidHost = (reason) => {
      logger.warn(`[config] Ignoring AX_CODE_HOST=${JSON.stringify(raw)}: ${reason}`);
    };

    let url;
    try {
      url = new URL(raw);
    } catch {
      warnInvalidHost('not a valid URL');
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      warnInvalidHost(`must use http or https scheme (got ${JSON.stringify(url.protocol)})`);
      return null;
    }
    const port = parseInt(url.port, 10);
    if (!Number.isFinite(port) || port <= 0) {
      warnInvalidHost('must include an explicit port (example: http://hostname:4096)');
      return null;
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      warnInvalidHost('must not include path, query, or hash');
      return null;
    }
    return { origin: url.origin, port };
  })();

  // AX_CODE_HOST takes precedence over AX_CODE_PORT when both are set
  const effectivePort = configuredAxCodeHost?.port ?? configuredAxCodePort;

  const configuredAxCodeHostname = (() => {
    const raw = env.AX_CODE_HOSTNAME || env.AX_CODE_DESKTOP_AX_CODE_HOSTNAME;
    if (typeof raw !== 'string') {
      return '127.0.0.1';
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      logger.warn(
        `[config] Ignoring AX_CODE_HOSTNAME=${JSON.stringify(raw)}: empty after trimming`,
      );
      return '127.0.0.1';
    }
    return trimmed;
  })();

  return {
    configuredAxCodePort,
    configuredAxCodeHost,
    effectivePort,
    configuredAxCodeHostname,
  };
};
