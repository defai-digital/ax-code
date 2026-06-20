import type { SettingsAPI, SettingsLoadResult, SettingsPayload } from '@openchamber/ui/api/types';
import { API_ENDPOINTS, HTTP_DEFAULTS } from './constants';

const SETTINGS_ENDPOINT = API_ENDPOINTS.config.settings;
const RELOAD_ENDPOINT = API_ENDPOINTS.config.reload;

const sanitizePayload = (data: unknown): SettingsPayload => {
  if (!data || typeof data !== 'object') {
    return {};
  }
  return data as SettingsPayload;
};

export const createWebSettingsAPI = (): SettingsAPI => ({
  async load(): Promise<SettingsLoadResult> {
    const response = await fetch(SETTINGS_ENDPOINT, {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    });

    if (!response.ok) {
      throw new Error(`Failed to load settings: ${response.statusText}`);
    }

    const payload = sanitizePayload(await response.json().catch(() => ({})));
    return {
      settings: payload,
      source: 'web',
    };
  },

  async save(changes: Partial<SettingsPayload>): Promise<SettingsPayload> {
    const response = await fetch(SETTINGS_ENDPOINT, {
      method: HTTP_DEFAULTS.method.put,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(changes),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Failed to save settings');
    }

    const payload = sanitizePayload(await response.json().catch(() => ({})));
    return payload;
  },

  async restartAxCode(): Promise<{ restarted: boolean }> {
    const response = await fetch(RELOAD_ENDPOINT, { method: HTTP_DEFAULTS.method.post });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Failed to restart ax-code');
    }
    return { restarted: true };
  },
});
