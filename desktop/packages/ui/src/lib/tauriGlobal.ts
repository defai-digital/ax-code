export type TauriInvoke = <TValue = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<TValue>;

export type TauriEventApi = {
  listen?: (
    event: string,
    handler: (evt: { payload?: unknown }) => void,
  ) => Promise<() => void>;
};

export type TauriGlobal = {
  core?: {
    invoke?: TauriInvoke;
  };
  dialog?: {
    open?: (options: Record<string, unknown>) => Promise<unknown>;
  };
  event?: TauriEventApi;
  shell?: {
    open?: (url: string) => Promise<unknown>;
  };
};

export const getTauriGlobal = (): TauriGlobal | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
};
