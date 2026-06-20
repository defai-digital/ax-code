import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session } from '@ax-code/sdk/v2';

const upsertedSessions: Session[] = [];
const registeredDirectories: Array<{ sessionID: string; directory: string }> = [];
const ensureChildCalls: Array<{ directory: string; bootstrap?: boolean }> = [];
const childState = {
  session: [] as Session[],
  sessionTotal: 0,
  limit: 5,
};
let currentDirectory = '/repo';

vi.doMock('@/sync/session-ui-store', () => ({
  routeMessage: vi.fn(() => Promise.resolve()),
  useSessionUIStore: {
    getState: () => ({
      setWorktreeMetadata: vi.fn(() => undefined),
    }),
  },
}));

vi.doMock('@/lib/ax-code/client', () => ({
  axCodeClient: {
    withDirectory: async (directory: string, fn: () => Promise<Session>) => {
      const previous = currentDirectory;
      currentDirectory = directory;
      try {
        return await fn();
      } finally {
        currentDirectory = previous;
      }
    },
    createSession: async (params?: { title?: string }): Promise<Session> => ({
      id: 'ses_multirun',
      title: params?.title ?? '',
      directory: currentDirectory,
      time: { created: 1, updated: 1 },
    } as Session),
    checkHealth: vi.fn(() => Promise.resolve(true)),
    getScopedSdkClient: vi.fn(() => ({})),
    getDirectory: vi.fn(() => currentDirectory),
  },
}));

// gitApi stubs that delegate to window.__AX_CODE_DESKTOP_RUNTIME_APIS__.git when present,
// so gitApi.test.ts (which installs runtime git in each test) still works correctly.
const _getGitRuntime = (): Record<string, (...args: unknown[]) => unknown> | null => {
  const w = globalThis as unknown as { window?: { __AX_CODE_DESKTOP_RUNTIME_APIS__?: { git?: Record<string, (...args: unknown[]) => unknown> } } };
  return w.window?.__AX_CODE_DESKTOP_RUNTIME_APIS__?.git ?? null;
};
const _runtimeOrStub = <T>(name: string, stub: T) =>
  (...args: unknown[]) => {
    const rt = _getGitRuntime();
    if (rt && typeof rt[name] === 'function') return rt[name](...args);
    return stub instanceof Promise ? stub : Promise.resolve(stub);
  };

vi.doMock('@/lib/gitApi', () => ({
  checkIsGitRepository: vi.fn(() => Promise.resolve(false)),
  getGitStatus: vi.fn(_runtimeOrStub('getGitStatus', { current: 'HEAD', tracking: null, ahead: 0, behind: 0, files: [], isClean: true })),
  getGitDiff: vi.fn(_runtimeOrStub('getGitDiff', {})),
  getGitFileDiff: vi.fn(_runtimeOrStub('getGitFileDiff', {})),
  revertGitFile: vi.fn(_runtimeOrStub('revertGitFile', undefined)),
  stageGitFile: vi.fn(_runtimeOrStub('stageGitFile', undefined)),
  stageGitFiles: vi.fn(_runtimeOrStub('stageGitFiles', undefined)),
  unstageGitFile: vi.fn(_runtimeOrStub('unstageGitFile', undefined)),
  unstageGitFiles: vi.fn(_runtimeOrStub('unstageGitFiles', undefined)),
  isLinkedWorktree: vi.fn(() => Promise.resolve(false)),
  getGitBranches: vi.fn(() => Promise.resolve({})),
  deleteGitBranch: vi.fn(() => Promise.resolve({ success: false })),
  deleteRemoteBranch: vi.fn(() => Promise.resolve({ success: false })),
  generateCommitMessage: vi.fn(() => Promise.resolve('')),
  generatePullRequestDescription: vi.fn(() => Promise.resolve('')),
  listGitWorktrees: vi.fn(() => Promise.resolve([])),
  validateGitWorktree: vi.fn(() => Promise.resolve({})),
  getGitWorktreeBootstrapStatus: vi.fn(() => Promise.resolve({})),
  previewGitWorktree: vi.fn(() => Promise.resolve({})),
  createGitWorktree: vi.fn(() => Promise.resolve({})),
  deleteGitWorktree: vi.fn(() => Promise.resolve({})),
  git: {},
  createGitCommit: vi.fn(() => Promise.resolve({})),
  gitPush: vi.fn(() => Promise.resolve({})),
  gitPull: vi.fn(() => Promise.resolve({})),
  gitFetch: vi.fn(() => Promise.resolve({})),
  listGitStashes: vi.fn(() => Promise.resolve({ stashes: [] })),
  countGitStashFiles: vi.fn(() => Promise.resolve({ counts: {} })),
  stashGitChanges: vi.fn(() => Promise.resolve({ success: false, created: false, message: '', output: '' })),
  discoverGitCredentials: vi.fn(() => Promise.resolve([])),
  getGlobalGitIdentity: vi.fn(() => Promise.resolve(null)),
  getRemoteUrl: vi.fn(() => Promise.resolve(null)),
  getRemotes: vi.fn(() => Promise.resolve([])),
  removeRemote: vi.fn(() => Promise.resolve({})),
  rebase: vi.fn(() => Promise.resolve({})),
  abortRebase: vi.fn(() => Promise.resolve({ success: false })),
  merge: vi.fn(() => Promise.resolve({})),
  checkoutCommit: vi.fn(() => Promise.resolve({})),
  cherryPick: vi.fn(() => Promise.resolve({})),
  revertCommit: vi.fn(() => Promise.resolve({})),
  resetToCommit: vi.fn(() => Promise.resolve({})),
  abortMerge: vi.fn(() => Promise.resolve({ success: false })),
  continueRebase: vi.fn(() => Promise.resolve({ success: false, conflict: false })),
  continueMerge: vi.fn(() => Promise.resolve({ success: false, conflict: false })),
  stash: vi.fn(() => Promise.resolve({})),
  stashPop: vi.fn(() => Promise.resolve({ success: false })),
  getConflictDetails: vi.fn(() => Promise.resolve({})),
  validateWorktreeDirectory: vi.fn(() => Promise.resolve({})),
  canonicalizeWorktreeState: vi.fn(() => Promise.resolve({})),
}));

vi.doMock('@/lib/worktrees/worktreeCreate', () => ({
  createWorktreeWithDefaults: vi.fn(),
  resolveRootTrackingRemote: vi.fn(() => Promise.resolve(null)),
}));

vi.doMock('@/lib/openchamberConfig', () => ({
  saveWorktreeSetupCommands: vi.fn(() => Promise.resolve()),
}));

vi.doMock('./useDirectoryStore', () => ({
  useDirectoryStore: {
    getState: () => ({ currentDirectory: '/repo' }),
  },
}));

vi.doMock('./useProjectsStore', () => ({
  useProjectsStore: {
    getState: () => ({
      activeProjectId: 'project-1',
      projects: [{ id: 'project-1', path: '/repo' }],
    }),
  },
}));

vi.doMock('./useSnippetsStore', () => ({
  useSnippetsStore: {
    getState: () => ({
      expandText: (value: string) => Promise.resolve(value),
    }),
  },
}));

// Minimal in-memory store state so tests that call useGlobalSessionsStore.setState() also work
let _mockGlobalActiveSessions: Session[] = [];
const _mockUpsertSession = (session: Session) => {
  upsertedSessions.push(session);
  const idx = _mockGlobalActiveSessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    _mockGlobalActiveSessions = [
      ..._mockGlobalActiveSessions.slice(0, idx),
      session,
      ..._mockGlobalActiveSessions.slice(idx + 1),
    ];
  } else {
    _mockGlobalActiveSessions = [..._mockGlobalActiveSessions, session];
  }
};

vi.doMock('./useGlobalSessionsStore', () => ({
  useGlobalSessionsStore: {
    getState: () => ({
      activeSessions: _mockGlobalActiveSessions,
      archivedSessions: [] as Session[],
      upsertSession: _mockUpsertSession,
    }),
    setState: (updater: unknown) => {
      const patch = typeof updater === 'function'
        ? (updater as (s: { activeSessions: Session[] }) => Partial<{ activeSessions: Session[] }>)({ activeSessions: _mockGlobalActiveSessions })
        : updater as Partial<{ activeSessions: Session[] }>;
      if (patch && 'activeSessions' in patch && Array.isArray((patch as { activeSessions: Session[] }).activeSessions)) {
        _mockGlobalActiveSessions = (patch as { activeSessions: Session[] }).activeSessions;
      }
    },
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.doMock('@/sync/sync-refs', () => ({
  setSyncRefs: vi.fn(() => undefined),
  registerSessionDirectory: (sessionID: string, directory: string) => {
    registeredDirectories.push({ sessionID, directory });
  },
  getSyncSDK: vi.fn(() => ({})),
  getSyncDirectory: vi.fn(() => '/repo'),
  getDirectoryState: vi.fn(() => undefined),
  getSyncSessions: vi.fn(() => []),
  getAllSyncSessions: vi.fn(() => []),
  getSyncMessages: vi.fn(() => []),
  getSyncSessionMaterializationStatus: vi.fn(() => undefined),
  getSyncParts: vi.fn(() => []),
  getSyncSessionStatus: vi.fn(() => undefined),
  getSyncPermissions: vi.fn(() => []),
  getSyncQuestions: vi.fn(() => []),
  getSyncChildStores: () => ({
    ensureChild: (directory: string, options?: { bootstrap?: boolean }) => {
      ensureChildCalls.push({ directory, bootstrap: options?.bootstrap });
      return {
        setState: (updater: typeof childState | ((state: typeof childState) => Partial<typeof childState> | typeof childState)) => {
          const patch = typeof updater === 'function' ? updater(childState) : updater;
          if (patch !== childState) {
            Object.assign(childState, patch);
          }
        },
      };
    },
  }),
}));

const { useMultiRunStore } = await import('./useMultiRunStore');

describe('useMultiRunStore', () => {
  beforeEach(() => {
    upsertedSessions.length = 0;
    registeredDirectories.length = 0;
    ensureChildCalls.length = 0;
    childState.session = [];
    childState.sessionTotal = 0;
    childState.limit = 5;
    currentDirectory = '/repo';
    useMultiRunStore.setState({ isLoading: false, error: null });
  });

  test('registers created sessions without waiting for a sidebar refresh', async () => {
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: false,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun']);
    expect(upsertedSessions.map((session) => session.id)).toEqual(['ses_multirun']);
    expect(registeredDirectories).toEqual([{ sessionID: 'ses_multirun', directory: '/repo' }]);
    expect(ensureChildCalls).toEqual([{ directory: '/repo', bootstrap: false }]);
    expect(childState.session.map((session) => session.id)).toEqual(['ses_multirun']);
  });
});
