export const DEFAULT_BACKGROUND_RELOAD_MIN_DELAY_MS = 1500;
export const DEFAULT_BACKGROUND_RELOAD_TIMEOUT_MS = 6 * 60 * 1000;

const normalizePositiveNumber = (value, fallback) => (
  Number.isFinite(value) && value > 0 ? value : fallback
);

export const createBackgroundAxCodeReloader = ({
  refreshAxCodeAfterConfigChange,
  clientReloadDelayMs,
  minReloadDelayMs = DEFAULT_BACKGROUND_RELOAD_MIN_DELAY_MS,
  reloadTimeoutMs = DEFAULT_BACKGROUND_RELOAD_TIMEOUT_MS,
}) => {
  if (typeof refreshAxCodeAfterConfigChange !== 'function') {
    throw new TypeError('refreshAxCodeAfterConfigChange must be a function');
  }

  const reloadDelayMs = Math.max(
    normalizePositiveNumber(clientReloadDelayMs, 0),
    normalizePositiveNumber(minReloadDelayMs, DEFAULT_BACKGROUND_RELOAD_MIN_DELAY_MS),
  );
  const effectiveReloadTimeoutMs = normalizePositiveNumber(reloadTimeoutMs, DEFAULT_BACKGROUND_RELOAD_TIMEOUT_MS);
  let currentReloadPromise = null;
  let queuedReloadReason = null;

  const runReloads = async (initialReason) => {
    let activeReason = initialReason;

    while (activeReason) {
      try {
        await refreshAxCodeAfterConfigChange(activeReason, {
          readyTimeoutMs: effectiveReloadTimeoutMs,
        });
      } catch (error) {
        console.error(`[Server] Background AX Code reload failed after ${activeReason}:`, error);
      }

      activeReason = queuedReloadReason;
      queuedReloadReason = null;
    }
  };

  const start = (reason) => {
    const reloadReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'configuration reload';

    if (currentReloadPromise) {
      queuedReloadReason = reloadReason;
      return {
        alreadyRunning: true,
        reloadDelayMs,
        reloadTimeoutMs: effectiveReloadTimeoutMs,
      };
    }

    currentReloadPromise = runReloads(reloadReason)
      .finally(() => {
        currentReloadPromise = null;
      });

    return {
      alreadyRunning: false,
      reloadDelayMs,
      reloadTimeoutMs: effectiveReloadTimeoutMs,
    };
  };

  return { start };
};
