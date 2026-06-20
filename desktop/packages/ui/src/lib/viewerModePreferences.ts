export type PreviewViewMode = 'preview' | 'edit';
export type JsonViewMode = 'tree' | 'text';

const parseStoredMode = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  return value;
};

const isPreviewViewMode = (value: string | null): value is PreviewViewMode =>
  value === 'preview' || value === 'edit';

const isJsonViewMode = (value: string | null): value is JsonViewMode =>
  value === 'tree' || value === 'text';

export function readPreviewViewModePreference(
  storage: Storage | null,
  key: string,
  fallback: PreviewViewMode
): PreviewViewMode {
  try {
    const stored = parseStoredMode(storage?.getItem(key) ?? null);
    return isPreviewViewMode(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function savePreviewViewModePreference(
  storage: Storage | null,
  key: string,
  mode: PreviewViewMode
): void {
  try {
    storage?.setItem(key, mode);
  } catch {
    // Ignore storage errors; viewer mode can fall back to in-memory state.
  }
}

export function readJsonViewModePreference(
  storage: Storage | null,
  key: string,
  fallback: JsonViewMode
): JsonViewMode {
  try {
    const stored = parseStoredMode(storage?.getItem(key) ?? null);
    return isJsonViewMode(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function saveJsonViewModePreference(
  storage: Storage | null,
  key: string,
  mode: JsonViewMode
): void {
  try {
    storage?.setItem(key, mode);
  } catch {
    // Ignore storage errors; viewer mode can fall back to in-memory state.
  }
}

export function getViewerModeStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}
