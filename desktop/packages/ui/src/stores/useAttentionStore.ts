import { create } from 'zustand';

/**
 * Count of sessions waiting for a permission approval, mirrored from sync
 * state by AttentionBadgeSync (which must live inside SyncProvider) so
 * consumers outside the provider — the window-title hook — can read it.
 */
interface AttentionStore {
  pendingApprovalCount: number;
  setPendingApprovalCount: (count: number) => void;
}

export const useAttentionStore = create<AttentionStore>((set) => ({
  pendingApprovalCount: 0,
  setPendingApprovalCount: (count) => {
    set((state) => (state.pendingApprovalCount === count ? state : { pendingApprovalCount: count }));
  },
}));
