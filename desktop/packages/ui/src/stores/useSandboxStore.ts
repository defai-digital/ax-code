import { create } from 'zustand';
import { axCodeClient } from '@/lib/ax-code/client';
import { toast } from '@/components/ui';
import { useI18nStore, formatMessage } from '@/lib/i18n/store';

/**
 * Sandbox (isolation) mode toggle for the desktop UI. The AX Code server
 * persists isolation to ax-code.json scoped by directory. Sandbox is "on"
 * when the isolation mode is not "full-access" (i.e. "read-only" or
 * "workspace-write"). Toggling sandbox on sets mode to "workspace-write";
 * toggling off sets mode to "full-access".
 */

const normalizeKey = (directory: string | null | undefined): string =>
  typeof directory === 'string' ? directory.trim() : '';

type SandboxState = {
  sandboxByDirectory: Record<string, boolean>;
  pendingByDirectory: Record<string, boolean>;
  loadedByDirectory: Record<string, boolean>;
};

type SandboxActions = {
  isSandbox: (directory: string | null | undefined) => boolean | undefined;
  isPending: (directory: string | null | undefined) => boolean;
  loadSandbox: (directory: string | null | undefined) => Promise<void>;
  setSandbox: (directory: string | null | undefined, enabled: boolean) => Promise<void>;
};

type SandboxStore = SandboxState & SandboxActions;

export const useSandboxStore = create<SandboxStore>()((set, get) => ({
  sandboxByDirectory: {},
  pendingByDirectory: {},
  loadedByDirectory: {},

  isSandbox: (directory) => get().sandboxByDirectory[normalizeKey(directory)],
  isPending: (directory) => get().pendingByDirectory[normalizeKey(directory)] === true,

  loadSandbox: async (directory) => {
    const key = normalizeKey(directory);
    const { pendingByDirectory, loadedByDirectory } = get();
    if (pendingByDirectory[key] || loadedByDirectory[key]) return;

    set((s) => ({ pendingByDirectory: { ...s.pendingByDirectory, [key]: true } }));

    const isolation = await axCodeClient.withDirectory(directory ?? null, async () => {
      return axCodeClient.getIsolation();
    });

    set((s) => {
      const next: Partial<SandboxState> = {
        pendingByDirectory: { ...s.pendingByDirectory, [key]: false },
      };
      if (isolation !== null) {
        next.sandboxByDirectory = {
          ...s.sandboxByDirectory,
          [key]: isolation.mode !== 'full-access',
        };
        next.loadedByDirectory = { ...s.loadedByDirectory, [key]: true };
      }
      return next;
    });
  },

  setSandbox: async (directory, enabled) => {
    const key = normalizeKey(directory);
    const previous = get().sandboxByDirectory[key];
    if (previous === enabled || get().pendingByDirectory[key]) return;

    // Optimistic: reflect the target immediately, mark pending.
    set((s) => ({
      sandboxByDirectory: { ...s.sandboxByDirectory, [key]: enabled },
      pendingByDirectory: { ...s.pendingByDirectory, [key]: true },
    }));

    const mode = enabled ? 'workspace-write' : 'full-access';
    const result = await axCodeClient.withDirectory(directory ?? null, async () => {
      return axCodeClient.setIsolation(mode);
    });

    set((s) => {
      const pendingByDirectory = { ...s.pendingByDirectory, [key]: false };
      if (result === null) {
        // Revert to the last confirmed state (or drop the optimistic value).
        const sandboxByDirectory = { ...s.sandboxByDirectory };
        if (previous === undefined) {
          delete sandboxByDirectory[key];
        } else {
          sandboxByDirectory[key] = previous;
        }
        return { sandboxByDirectory, pendingByDirectory };
      }
      return {
        sandboxByDirectory: { ...s.sandboxByDirectory, [key]: result.mode !== 'full-access' },
        loadedByDirectory: { ...s.loadedByDirectory, [key]: true },
        pendingByDirectory,
      };
    });

    if (result === null) {
      toast.error(formatMessage(useI18nStore.getState().dictionary, 'chat.chatInput.sandbox.updateFailed'));
    }
  },
}));
