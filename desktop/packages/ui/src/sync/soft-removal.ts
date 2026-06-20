import { toast } from '@/components/ui';
import { axCodeClient } from '@/lib/ax-code/client';
import {
  useGlobalSessionsStore,
  resolveGlobalSessionDirectory,
  type PendingRemovalEntry,
  type PendingRemovalKind,
} from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import * as sessionActions from '@/sync/session-actions';
import { formatMessage, useI18nStore, type I18nKey, type I18nParams } from '@/lib/i18n/store';
import type { Session } from '@ax-code/sdk/v2';

const UNDO_DURATION_MS = 7000;
const STORAGE_KEY = 'axcode.pending-session-removals';

type PersistedRemoval = {
  id: string;
  kind: PendingRemovalKind;
  directory: string | null;
};

const timerBySession = new Map<string, ReturnType<typeof setTimeout>>();

const tr = (key: I18nKey, params?: I18nParams): string =>
  formatMessage(useI18nStore.getState().dictionary, key, params);

function clearTimers(ids: string[]): void {
  for (const id of ids) {
    const timer = timerBySession.get(id);
    if (timer) clearTimeout(timer);
    timerBySession.delete(id);
  }
}

/**
 * Mirror the store's pending-removal map to localStorage so removals the
 * user did not undo are still committed if the app quits during the undo
 * window (see recoverPendingRemovals).
 */
function persistPending(): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Array.from(useGlobalSessionsStore.getState().pendingRemoval.values());
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload: PersistedRemoval[] = entries.map((entry) => ({
      id: entry.session.id,
      kind: entry.kind,
      directory: resolveGlobalSessionDirectory(entry.session),
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable — quit-recovery degrades to best-effort flush.
  }
}

function readPersisted(): PersistedRemoval[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PersistedRemoval => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Partial<PersistedRemoval>;
      return typeof candidate.id === 'string'
        && (candidate.kind === 'archive' || candidate.kind === 'delete');
    });
  } catch {
    return [];
  }
}

function successMessage(kind: PendingRemovalKind, count: number): string {
  if (count === 1) {
    return tr(kind === 'delete'
      ? 'sessions.sidebar.session.delete.success'
      : 'sessions.sidebar.session.archive.success');
  }
  return tr(kind === 'delete'
    ? 'sessions.sidebar.bulkActions.deletedPlural'
    : 'sessions.sidebar.bulkActions.archivedPlural', { count });
}

function failureMessage(kind: PendingRemovalKind, count: number): string {
  if (count === 1) {
    return tr(kind === 'delete'
      ? 'sessions.sidebar.session.delete.error'
      : 'sessions.sidebar.session.archive.error');
  }
  return tr(kind === 'delete'
    ? 'sessions.sidebar.bulkActions.failedDeletePlural'
    : 'sessions.sidebar.bulkActions.failedArchivePlural', { count });
}

async function commitRemovals(ids: string[]): Promise<void> {
  const store = useGlobalSessionsStore.getState();
  const entries = ids
    .map((id) => store.pendingRemoval.get(id))
    .filter((entry): entry is PendingRemovalEntry => Boolean(entry));
  if (entries.length === 0) return;

  // Release the pending flags before the API calls so session-actions' own
  // store updates (archive bucket move, rollback on failure) apply cleanly.
  store.commitPendingRemoval(entries.map((entry) => entry.session.id));
  clearTimers(ids);

  const failed: PendingRemovalEntry[] = [];
  await Promise.all(entries.map(async (entry) => {
    const ok = entry.kind === 'delete'
      ? await sessionActions.deleteSession(entry.session.id)
      : await sessionActions.archiveSession(entry.session.id);
    if (ok && entry.kind === 'archive') {
      // The session left the active list at mark time, so the store-level
      // archiveSessions() move found nothing — add it to the archived
      // bucket directly.
      useGlobalSessionsStore.getState().upsertSession({
        ...entry.session,
        time: { ...entry.session.time, archived: Date.now() },
      });
    }
    if (!ok) failed.push(entry);
  }));
  // Only now is it safe to drop the persisted entries: a quit while the
  // requests were in flight is recovered on next launch (idempotent).
  persistPending();

  if (failed.length > 0) {
    for (const entry of failed) {
      useGlobalSessionsStore.getState().upsertSession(entry.session);
    }
    for (const kind of ['archive', 'delete'] as const) {
      const count = failed.filter((entry) => entry.kind === kind).length;
      if (count > 0) {
        toast.error(failureMessage(kind, count));
      }
    }
  }
}

function undoRemovals(ids: string[]): void {
  clearTimers(ids);
  useGlobalSessionsStore.getState().undoPendingRemoval(ids);
  persistPending();
}

function softRemoveSessions(sessions: Session[], kind: PendingRemovalKind): void {
  const store = useGlobalSessionsStore.getState();
  const fresh = sessions.filter((session) => session?.id && !store.pendingRemoval.has(session.id));
  if (fresh.length === 0) return;

  store.markPendingRemoval(fresh.map((session) => ({ session, kind })));
  persistPending();

  const ids = fresh.map((session) => session.id);
  const ui = useSessionUIStore.getState();
  if (ui.currentSessionId && ids.includes(ui.currentSessionId)) {
    ui.setCurrentSession(null);
  }

  const timer = setTimeout(() => {
    void commitRemovals(ids);
  }, UNDO_DURATION_MS);
  for (const id of ids) timerBySession.set(id, timer);

  toast.success(successMessage(kind, ids.length), {
    duration: UNDO_DURATION_MS,
    action: {
      label: tr('sessions.sidebar.softRemoval.undo'),
      onClick: () => undoRemovals(ids),
    },
  });
}

export function softArchiveSession(session: Session): void {
  softRemoveSessions([session], 'archive');
}

export function softDeleteSession(session: Session): void {
  softRemoveSessions([session], 'delete');
}

export function softBulkArchive(sessions: Session[]): void {
  softRemoveSessions(sessions, 'archive');
}

export function softBulkDelete(sessions: Session[]): void {
  softRemoveSessions(sessions, 'delete');
}

/**
 * Commit all pending removals immediately. Called on beforeunload; the
 * requests are fire-and-forget, so the persisted entries are intentionally
 * kept — recoverPendingRemovals finishes the job on next launch if these
 * never reached the server.
 */
export function flushPendingRemovals(): void {
  const ids = Array.from(useGlobalSessionsStore.getState().pendingRemoval.keys());
  if (ids.length === 0) return;
  void commitRemovals(ids);
}

/**
 * Commit removals left over from a previous app session (quit during the
 * undo window). Safe to repeat: re-archiving is a timestamp update and
 * deleting an already-deleted session fails quietly.
 */
export async function recoverPendingRemovals(): Promise<void> {
  const persisted = readPersisted();
  if (persisted.length === 0) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }

  const sdkClient = axCodeClient.getSdkClient();
  await Promise.all(persisted.map(async ({ id, kind, directory }) => {
    try {
      if (kind === 'delete') {
        await sdkClient.session.delete({ sessionID: id, directory: directory ?? undefined });
      } else {
        await sdkClient.session.update({
          sessionID: id,
          directory: directory ?? undefined,
          time: { archived: Date.now() },
        });
      }
    } catch (error) {
      console.warn('[soft-removal] failed to recover pending removal', { id, kind }, error);
    }
  }));
}
