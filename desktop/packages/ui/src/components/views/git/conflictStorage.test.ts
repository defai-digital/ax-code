import { describe, expect, test } from 'vitest';
import { parseBranchConflictState, parseIntegrateConflictState } from './conflictStorage';

describe('parseBranchConflictState', () => {
  test('accepts valid conflict state', () => {
    expect(parseBranchConflictState(JSON.stringify({
      directory: '/repo',
      conflictFiles: ['src/a.ts'],
      operation: 'rebase',
    }), '/repo')).toEqual({
      directory: '/repo',
      conflictFiles: ['src/a.ts'],
      operation: 'rebase',
    });
  });

  test('defaults older branch conflict state safely', () => {
    expect(parseBranchConflictState(JSON.stringify({
      directory: '/repo',
    }), '/repo')).toEqual({
      directory: '/repo',
      conflictFiles: [],
      operation: 'merge',
    });
  });

  test('rejects malformed or stale branch conflict state', () => {
    expect(parseBranchConflictState('{', '/repo')).toBeNull();
    expect(parseBranchConflictState(JSON.stringify({ directory: '/other' }), '/repo')).toBeNull();
    expect(parseBranchConflictState(JSON.stringify({
      directory: '/repo',
      conflictFiles: ['src/a.ts', 1],
      operation: 'merge',
    }), '/repo')).toBeNull();
    expect(parseBranchConflictState(JSON.stringify({
      directory: '/repo',
      conflictFiles: [],
      operation: 'cherry-pick',
    }), '/repo')).toBeNull();
  });
});

describe('parseIntegrateConflictState', () => {
  test('accepts valid integrate conflict state', () => {
    expect(parseIntegrateConflictState(JSON.stringify({
      repoRoot: '/repo',
      tempWorktreePath: '/tmp/integrate',
      sourceBranch: 'feature',
      targetBranch: 'main',
      cleanTargetWorktrees: ['/repo-main'],
      remainingCommits: ['abc123'],
      currentCommit: 'def456',
    }), '/repo')).toEqual({
      repoRoot: '/repo',
      tempWorktreePath: '/tmp/integrate',
      sourceBranch: 'feature',
      targetBranch: 'main',
      cleanTargetWorktrees: ['/repo-main'],
      remainingCommits: ['abc123'],
      currentCommit: 'def456',
    });
  });

  test('rejects stale or malformed integrate conflict state', () => {
    expect(parseIntegrateConflictState('{', '/repo')).toBeNull();
    expect(parseIntegrateConflictState(JSON.stringify({
      repoRoot: '/other',
      tempWorktreePath: '/tmp/integrate',
      sourceBranch: 'feature',
      targetBranch: 'main',
      cleanTargetWorktrees: [],
      remainingCommits: [],
      currentCommit: 'def456',
    }), '/repo')).toBeNull();
    expect(parseIntegrateConflictState(JSON.stringify({
      repoRoot: '/repo',
      tempWorktreePath: '',
      sourceBranch: 'feature',
      targetBranch: 'main',
      cleanTargetWorktrees: [],
      remainingCommits: [],
      currentCommit: 'def456',
    }), '/repo')).toBeNull();
    expect(parseIntegrateConflictState(JSON.stringify({
      repoRoot: '/repo',
      tempWorktreePath: '/tmp/integrate',
      sourceBranch: 'feature',
      targetBranch: 'main',
      cleanTargetWorktrees: [1],
      remainingCommits: [],
      currentCommit: 'def456',
    }), '/repo')).toBeNull();
  });
});
