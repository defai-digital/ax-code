import { isDesktopShell } from '@/lib/desktop';
import { getTauriGlobal } from '@/lib/tauriGlobal';

type InvokeArgs = Record<string, unknown>;

const getInvoke = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  const tauri = getTauriGlobal();
  return typeof tauri?.core?.invoke === 'function' ? tauri.core.invoke : null;
};

export const invokeDesktopCommand = async <TValue = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<TValue> => {
  const invoke = getInvoke();
  if (!invoke) {
    throw new Error('Desktop runtime is not available');
  }
  return invoke(command, args) as Promise<TValue>;
};

export const startDesktopWindowDrag = async (): Promise<void> => {
  // Electron has no JS window-drag API. Window dragging is handled entirely via
  // CSS `-webkit-app-region: drag` on the title-bar region (see `.app-region-drag`
  // in index.css), so there is nothing to do here.
  return;
};

export const isDesktopWindowFullscreen = async (): Promise<boolean> => {
  if (!isDesktopShell()) {
    return false;
  }

  try {
    return Boolean(await invokeDesktopCommand('desktop_is_window_fullscreen'));
  } catch {
    return false;
  }
};

export const onDesktopWindowResized = (handler: () => void): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
};

export const setDesktopWindowTitle = async (title: string): Promise<void> => {
  if (!isDesktopShell()) {
    return;
  }

  try {
    await invokeDesktopCommand('desktop_set_window_title', { title });
  } catch {
    // ignore
  }
};

export const setDesktopBadgeCount = async (count: number): Promise<void> => {
  if (!isDesktopShell()) {
    return;
  }

  try {
    await invokeDesktopCommand('desktop_set_badge_count', { count });
  } catch {
    // badge is best-effort decoration
  }
};

export const setDesktopWindowTheme = async (
  themeMode?: string,
  themeVariant?: string,
): Promise<void> => {
  if (!isDesktopShell()) {
    return;
  }

  try {
    await invokeDesktopCommand('desktop_set_window_theme', { themeMode, themeVariant });
  } catch {
    // ignore
  }
};

export const getDesktopAppVersion = async (): Promise<string | null> => {
  if (!isDesktopShell()) {
    return null;
  }

  try {
    const version = await invokeDesktopCommand('desktop_get_app_version');
    return typeof version === 'string' && version.trim().length > 0 ? version : null;
  } catch {
    return null;
  }
};

export const readDesktopFile = async (
  path: string,
): Promise<{ mime: string; base64: string; size?: number }> => {
  return invokeDesktopCommand('desktop_read_file', { path });
};

export const readDesktopFileAsDataUrl = async (path: string): Promise<string> => {
  const result = await readDesktopFile(path);
  return `data:${result.mime || 'application/octet-stream'};base64,${result.base64}`;
};

export const listenDesktopNativeDragDrop = async (
  handler: (event: unknown) => void,
): Promise<(() => void) | null> => {
  // Electron uses the renderer's native DOM drag/drop events instead of a
  // separate webview drag listener, so there is no native listener to attach.
  void handler;
  return null;
};
