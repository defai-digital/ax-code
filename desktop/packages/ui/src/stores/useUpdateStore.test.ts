import { beforeEach, describe, expect, test } from 'vitest';
import { useUpdateStore } from './useUpdateStore';

let invokedCommands: string[] = [];

const restoreWindow = () => {
  delete (globalThis as Record<string, unknown>).window;
};

const mockElectronUpdaterWindow = () => {
  (globalThis as Record<string, unknown>).window = {
    location: { origin: 'http://localhost:5173' },
    __AX_CODE_DESKTOP_ELECTRON__: { runtime: 'electron' },
    __TAURI__: {
      core: {
        invoke: async (command: string) => {
          invokedCommands.push(command);
          if (command === 'desktop_check_for_updates') {
            return {
              available: false,
              currentVersion: '1.1.1',
            };
          }
          return null;
        },
      },
    },
  };
};

describe('useUpdateStore runtime detection', () => {
  beforeEach(() => {
    invokedCommands = [];
    mockElectronUpdaterWindow();
    useUpdateStore.getState().reset();
  });

  test('uses the native updater for the local Electron desktop shell', async () => {
    try {
      await useUpdateStore.getState().checkForUpdates();

      expect(invokedCommands).toEqual(['desktop_check_for_updates']);
      expect(useUpdateStore.getState().runtimeType).toBe('desktop');
      expect(useUpdateStore.getState().info).toEqual({
        available: false,
        currentVersion: '1.1.1',
      });
    } finally {
      restoreWindow();
    }
  });
});
