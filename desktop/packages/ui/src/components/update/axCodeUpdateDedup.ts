/**
 * Pure decision helpers for the ax-code update toast.
 *
 * Extracted from `AxCodeUpdateToast.tsx` so the dedup decisions can be
 * unit-tested without a DOM, storage, or React. The
 * React surfaces remain the sole owners of side effects (storage writes,
 * `toast.info`, event listeners). This module only answers the question
 * "given these inputs, should we show the toast?".
 *
 * Exposed for unit testing. Not part of the stable consumer surface.
 */

export interface AxCodeUpdateToastDecisionInput {
  /** Version string reported by the server (already trimmed by the caller). */
  readonly version: string;
  /** Most recent version the user explicitly dismissed, or `null` if none. */
  readonly dismissedVersion: string | null;
  /** Set of versions already surfaced in this tab session. */
  readonly seenVersions: ReadonlySet<string>;
}

/**
 * Returns `true` if the ax-code update toast should be shown for `version`.
 *
 * Empty/whitespace-only versions short-circuit to `false`. A non-null
 * `dismissedVersion` matching the incoming version also short-circuits; a
 * different `dismissedVersion` means a newer release has appeared since the
 * last dismissal and the toast surfaces again.
 */
export const shouldShowAxCodeUpdateToast = (
  input: AxCodeUpdateToastDecisionInput,
): boolean => {
  if (!input.version) return false;
  if (input.seenVersions.has(input.version)) return false;
  if (input.dismissedVersion !== null && input.dismissedVersion === input.version) return false;
  return true;
};

/**
 * Coerces the `detail.version` carried by an `openchamber:ax-code-update-available`
 * CustomEvent into a trimmed string, or returns `''` when the payload is
 * missing or shaped unexpectedly.
 *
 * Only `string` is accepted; numeric or boolean payloads are rejected because
 * downstream callers compare versions by literal equality.
 */
export const resolveAxCodeUpdateVersion = (detail: unknown): string => {
  if (detail === null || typeof detail !== 'object') return '';
  const candidate = (detail as { version?: unknown }).version;
  if (typeof candidate !== 'string') return '';
  return candidate.trim();
};

export interface AxCodeUpgradeStatusLike {
  readonly available?: boolean | null;
  readonly latestVersion?: string | null;
  readonly currentVersion?: string | null;
  readonly minSupportedVersion?: string | null;
  readonly compatible?: boolean | null;
}

/**
 * Pulls the candidate version out of an `/api/ax-code/upgrade-status` JSON
 * payload. Returns `''` when the payload is missing the field, has the wrong
 * type, or reports `available !== true`.
 */
export const resolveAxCodeUpgradeStatusVersion = (
  status: AxCodeUpgradeStatusLike | null | undefined,
): string => {
  if (!status) return '';
  if (status.available !== true) return '';
  if (typeof status.latestVersion !== 'string') return '';
  return status.latestVersion.trim();
};

export interface AxCodeIncompatibility {
  readonly version: string;
  readonly minSupportedVersion: string;
}

/**
 * Pulls an incompatibility report out of an `/api/ax-code/upgrade-status`
 * JSON payload. Returns `null` unless the server explicitly reported
 * `compatible: false` alongside both version strings.
 */
export const resolveAxCodeIncompatibility = (
  status: AxCodeUpgradeStatusLike | null | undefined,
): AxCodeIncompatibility | null => {
  if (!status || status.compatible !== false) return null;
  if (typeof status.currentVersion !== 'string' || typeof status.minSupportedVersion !== 'string') return null;
  const version = status.currentVersion.trim();
  const minSupportedVersion = status.minSupportedVersion.trim();
  if (!version || !minSupportedVersion) return null;
  return { version, minSupportedVersion };
};
