import { create } from 'zustand';
import { axCodeClient } from '@/lib/ax-code/client';
import { toast } from '@/components/ui';
import { useI18nStore, formatMessage } from '@/lib/i18n/store';

/**
 * The AX Code server exposes two layered execution settings, persisted to
 * ax-code.json and scoped by directory:
 *  - `autonomous`: auto-approves safe tools and continues multi-step runs.
 *  - `super_long`: adds a duration ceiling + request pacing on top of
 *    autonomous (the server returns 409 if enabled while autonomous is off).
 *
 * We collapse the two booleans into a single user-facing mode:
 *  - manual     → autonomous off
 *  - autonomous → autonomous on, super-long off
 *  - long-run   → autonomous on, super-long on
 */
export type ExecutionMode = 'manual' | 'autonomous' | 'long-run';

const deriveMode = (autonomous: boolean, superLong: boolean): ExecutionMode => {
  if (!autonomous) return 'manual';
  return superLong ? 'long-run' : 'autonomous';
};

const normalizeKey = (directory: string | null | undefined): string =>
  typeof directory === 'string' ? directory.trim() : '';

type ExecutionModeState = {
  modeByDirectory: Record<string, ExecutionMode>;
  pendingByDirectory: Record<string, boolean>;
  loadedByDirectory: Record<string, boolean>;
};

type ExecutionModeActions = {
  getMode: (directory: string | null | undefined) => ExecutionMode | undefined;
  isPending: (directory: string | null | undefined) => boolean;
  loadMode: (directory: string | null | undefined) => Promise<void>;
  setMode: (directory: string | null | undefined, mode: ExecutionMode) => Promise<void>;
};

type ExecutionModeStore = ExecutionModeState & ExecutionModeActions;

/**
 * Apply a target mode by toggling the two server flags in a dependency-safe
 * order (autonomous must be on before super-long can be enabled, and off
 * after super-long is disabled). Returns the derived mode the server settled
 * on, or null if any call failed.
 */
const applyMode = async (
  directory: string | null | undefined,
  mode: ExecutionMode,
): Promise<ExecutionMode | null> =>
  axCodeClient.withDirectory(directory ?? null, async () => {
    if (mode === 'manual') {
      const superLong = await axCodeClient.setSuperLongEnabled(false);
      const autonomous = await axCodeClient.setAutonomousEnabled(false);
      if (superLong === null || autonomous === null) return null;
      return deriveMode(autonomous, superLong);
    }

    const autonomous = await axCodeClient.setAutonomousEnabled(true);
    if (autonomous === null) return null;
    const superLong = await axCodeClient.setSuperLongEnabled(mode === 'long-run');
    if (superLong === null) return null;
    return deriveMode(autonomous, superLong);
  });

export const useExecutionModeStore = create<ExecutionModeStore>()((set, get) => ({
  modeByDirectory: {},
  pendingByDirectory: {},
  loadedByDirectory: {},

  getMode: (directory) => get().modeByDirectory[normalizeKey(directory)],
  isPending: (directory) => get().pendingByDirectory[normalizeKey(directory)] === true,

  loadMode: async (directory) => {
    const key = normalizeKey(directory);
    const { pendingByDirectory, loadedByDirectory } = get();
    if (pendingByDirectory[key] || loadedByDirectory[key]) return;

    set((s) => ({ pendingByDirectory: { ...s.pendingByDirectory, [key]: true } }));

    const flags = await axCodeClient.withDirectory(directory ?? null, async () => {
      const [autonomous, superLong] = await Promise.all([
        axCodeClient.getAutonomousEnabled(),
        axCodeClient.getSuperLongEnabled(),
      ]);
      return { autonomous, superLong };
    });

    set((s) => {
      const next: Partial<ExecutionModeState> = {
        pendingByDirectory: { ...s.pendingByDirectory, [key]: false },
      };
      // Leave the mode unset on a failed read so the UI can stay neutral
      // rather than asserting an authoritative state we never confirmed.
      if (flags.autonomous !== null && flags.superLong !== null) {
        next.modeByDirectory = {
          ...s.modeByDirectory,
          [key]: deriveMode(flags.autonomous, flags.superLong),
        };
        next.loadedByDirectory = { ...s.loadedByDirectory, [key]: true };
      }
      return next;
    });
  },

  setMode: async (directory, mode) => {
    const key = normalizeKey(directory);
    const previous = get().modeByDirectory[key];
    if (previous === mode || get().pendingByDirectory[key]) return;

    // Optimistic: reflect the target immediately, mark pending.
    set((s) => ({
      modeByDirectory: { ...s.modeByDirectory, [key]: mode },
      pendingByDirectory: { ...s.pendingByDirectory, [key]: true },
    }));

    const settled = await applyMode(directory, mode);

    set((s) => {
      const pendingByDirectory = { ...s.pendingByDirectory, [key]: false };
      if (settled === null) {
        // Revert to the last confirmed mode (or drop the optimistic value).
        const modeByDirectory = { ...s.modeByDirectory };
        if (previous === undefined) {
          delete modeByDirectory[key];
        } else {
          modeByDirectory[key] = previous;
        }
        return { modeByDirectory, pendingByDirectory };
      }
      return {
        modeByDirectory: { ...s.modeByDirectory, [key]: settled },
        loadedByDirectory: { ...s.loadedByDirectory, [key]: true },
        pendingByDirectory,
      };
    });

    if (settled === null) {
      toast.error(formatMessage(useI18nStore.getState().dictionary, 'chat.chatInput.executionMode.updateFailed'));
    }
  },
}));
