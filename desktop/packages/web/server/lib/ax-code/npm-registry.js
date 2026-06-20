// npm registry access is disabled: this app must never contact
// registry.npmjs.org. The public API (lookupNpmPackage / getNpmInfo /
// clearCache) is preserved so the plugin/feature routes keep working — every
// lookup resolves to a "network" error, which callers already handle by
// omitting npm version/metadata for the package.

export const NPM_CACHE_TTL_MS = 3_600_000;
export const NPM_FETCH_TIMEOUT_MS = 5_000;
export const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';

/**
 * @typedef {Object} NpmLookupError
 * @property {false} ok
 * @property {'network'} status
 * @property {string} error
 */

/** @type {NpmLookupError} */
const DISABLED_RESULT = Object.freeze({
  ok: false,
  status: 'network',
  error: 'npm registry access is disabled',
});

/**
 * @returns {Promise<NpmLookupError>}
 */
export async function lookupNpmPackage() {
  return DISABLED_RESULT;
}

/**
 * @returns {Promise<NpmLookupError>}
 */
export async function getNpmInfo() {
  return DISABLED_RESULT;
}

export function clearCache() {}
