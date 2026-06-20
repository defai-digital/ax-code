import { API_ENDPOINTS, replacePathParams } from '@/lib/http';
import { axCodeClient } from './client';
import type { ProviderSources } from '@/components/sections/providers/types';

const PROVIDER_REQUEST_RETRY_DELAYS_MS = [250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3000, 3000];
const PROVIDER_RESTART_POLL_MS = 2000;

export { PROVIDER_REQUEST_RETRY_DELAYS_MS, PROVIDER_RESTART_POLL_MS };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProviderRetryOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export const isRestartingError = (error: unknown): boolean =>
  isRecord(error) && error.restarting === true;

export const getCurrentDirectory = (): string | null => {
  const dir = axCodeClient.getDirectory();
  if (typeof dir === 'string' && dir.trim().length > 0) {
    return dir.trim();
  }
  return null;
};

// In the desktop app the renderer is served from its own local origin, which is
// NOT the AX Code server. A bare relative "/api/..." fetch would resolve against
// that renderer origin and never reach the server, surfacing as "Unable to load
// provider list" / "Failed to load provider authentication methods". Resolve the
// AX Code server origin first (mirrors gitApiHttp.ts resolveBaseOrigin), falling
// back to window.location.origin on web where they coincide.
const resolveBaseOrigin = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  const desktopOrigin = window.__AX_CODE_DESKTOP_DESKTOP_SERVER__?.origin;
  if (desktopOrigin) {
    return desktopOrigin;
  }
  return window.location.origin;
};

export const buildDirectoryUrl = (path: string, directory: string | null): string => {
  const origin = resolveBaseOrigin();
  // On the server (no window) there is no origin to resolve against; keep the
  // relative path and append the query manually.
  if (!origin) {
    if (!directory) return path;
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}directory=${encodeURIComponent(directory)}`;
  }
  const url = new URL(path, origin);
  if (directory) {
    url.searchParams.set('directory', directory);
  }
  return url.toString();
};

export const fetchProviderJsonWithRetry = async (url: string, init: RequestInit, options: ProviderRetryOptions = {}) => {
  const retryDelaysMs = options.retryDelaysMs ?? PROVIDER_REQUEST_RETRY_DELAYS_MS;
  const sleepFor = options.sleep ?? sleep;
  let lastError: unknown = null;
  let lastRestarting = false;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        return payload;
      }

      const restarting = response.status === 503 && isRecord(payload) && payload.restarting === true;
      lastRestarting = restarting;
      if (restarting && attempt < retryDelaysMs.length) {
        lastError = new Error('AX Code is restarting');
        await sleepFor(retryDelaysMs[attempt] ?? 0);
        continue;
      }

      const message = isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Provider request failed (${response.status})`;
      throw Object.assign(new Error(message), { noRetry: true, restarting });
    } catch (error) {
      lastError = error;
      lastRestarting = isRecord(error) && error.restarting === true;
      if (isRecord(error) && error.noRetry === true) {
        break;
      }
      if (attempt >= retryDelaysMs.length) {
        break;
      }
      await sleepFor(retryDelaysMs[attempt] ?? 0);
      continue;
    }
  }

  // Preserve 503+restarting context so callers that poll on restart keep going.
  throw lastError instanceof Error
    ? (lastRestarting ? Object.assign(lastError, { restarting: true }) : lastError)
    : new Error('Provider request failed');
};

export interface AuthMethod {
  type?: string;
  name?: string;
  label?: string;
  description?: string;
  help?: string;
  method?: number;
  [key: string]: unknown;
}

export interface ProviderOption {
  id: string;
  name?: string;
}

export const normalizeAuthType = (method: AuthMethod) => {
  const raw = typeof method.type === 'string' ? method.type : '';
  const label = `${method.name ?? ''} ${method.label ?? ''}`.toLowerCase();
  const merged = `${raw} ${label}`.toLowerCase();
  if (merged.includes('oauth')) return 'oauth';
  if (merged.includes('api')) return 'api';
  return raw.toLowerCase();
};

export const parseAuthMethodsPayload = (payload: unknown): Record<string, AuthMethod[]> => {
  if (!isRecord(payload)) {
    return {};
  }
  const result: Record<string, AuthMethod[]> = {};
  for (const [providerId, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      result[providerId] = value.filter((entry) => isRecord(entry)) as AuthMethod[];
    }
  }
  return result;
};

const normalizeProviderEntry = (entry: unknown): ProviderOption | null => {
  if (typeof entry === 'string') {
    return { id: entry };
  }
  if (!isRecord(entry)) {
    return null;
  }
  const idCandidate =
    (typeof entry.id === 'string' && entry.id) ||
    (typeof entry.providerID === 'string' && entry.providerID) ||
    (typeof entry.slug === 'string' && entry.slug) ||
    (typeof entry.name === 'string' && entry.name);
  if (!idCandidate) {
    return null;
  }
  const nameCandidate = typeof entry.name === 'string' ? entry.name : undefined;
  return { id: idCandidate, name: nameCandidate };
};

export const parseAvailableProvidersPayload = (payload: unknown): ProviderOption[] => {
  let entries: unknown[] = [];

  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.all)) {
      entries = payload.all;
    } else if (Array.isArray(payload.providers)) {
      entries = payload.providers;
    }
  }

  const mapped = entries
    .map((entry) => normalizeProviderEntry(entry))
    .filter((entry): entry is ProviderOption => Boolean(entry));

  const seen = new Set<string>();
  return mapped.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
};

export const fetchProviderAuthMethods = async (directory: string | null) => {
  const url = buildDirectoryUrl(API_ENDPOINTS.provider.auth, directory);
  return fetchProviderJsonWithRetry(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
};

export const fetchAvailableProviders = async (directory: string | null) => {
  const url = buildDirectoryUrl(API_ENDPOINTS.provider.base, directory);
  return fetchProviderJsonWithRetry(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
};

export const fetchProviderSources = async (providerId: string, directory: string | null) => {
  const url = buildDirectoryUrl(
    replacePathParams(API_ENDPOINTS.provider.source, { providerId }),
    directory,
  );
  const payload = await fetchProviderJsonWithRetry(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return (payload?.sources ?? payload?.data?.sources) as ProviderSources | undefined;
};

export const disconnectProviderAuth = async (providerId: string, directory: string | null, scope = 'all') => {
  const baseUrl = buildDirectoryUrl(
    replacePathParams(API_ENDPOINTS.provider.authAll, { providerId }),
    directory,
  );
  const origin = resolveBaseOrigin();
  const url = new URL(baseUrl, !origin ? 'http://localhost' : origin);
  url.searchParams.set('scope', scope);
  const requestUrl = !origin
    ? `${url.pathname}${url.search}`
    : url.toString();

  return fetchProviderJsonWithRetry(requestUrl, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
};
