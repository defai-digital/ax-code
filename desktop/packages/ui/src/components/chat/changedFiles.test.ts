import { describe, expect, test } from 'vitest';
import type { ToolPart } from '@ax-code/sdk/v2';

import {
  extractChangedFiles,
  getFileStats,
  isSyntheticDiffFile,
  toRelativePath,
} from './changedFiles';

type ToolFixtureOptions = {
  id?: string;
  tool?: string;
  status?: 'pending' | 'running' | 'completed' | 'error';
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const toolPart = (options: ToolFixtureOptions): ToolPart => {
  const status = options.status ?? 'completed';
  const base = {
    id: options.id ?? 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: `${options.id ?? 'tool-1'}-call`,
    tool: options.tool ?? 'edit',
  } satisfies Omit<ToolPart, 'state'>;

  if (status === 'pending') {
    return {
      ...base,
      state: {
        status,
        input: options.input ?? {},
        raw: '',
      },
    };
  }

  if (status === 'running') {
    return {
      ...base,
      state: {
        status,
        input: options.input ?? {},
        metadata: options.metadata,
        time: { start: 1 },
      },
    };
  }

  if (status === 'error') {
    return {
      ...base,
      state: {
        status,
        input: options.input ?? {},
        error: 'failed',
        metadata: options.metadata,
        time: { start: 1, end: 2 },
      },
    };
  }

  return {
    ...base,
    state: {
      status,
      input: options.input ?? {},
      output: '',
      title: 'Edit',
      metadata: options.metadata ?? {},
      time: { start: 1, end: 2 },
    },
  };
};

describe('extractChangedFiles', () => {
  test('extracts metadata file entries with stats and de-dupes paths', () => {
    const files = extractChangedFiles([
      toolPart({
        id: 'tool-a',
        metadata: {
          files: [
            { relativePath: 'src/app.ts', additions: 3.7, deletions: 1, patch: '+new\n-old' },
            { filePath: 'src/app.ts', additions: 99, deletions: 99 },
            { filePath: 'src/other.ts', additions: -3, deletions: 2.2 },
          ],
        },
      }),
    ]);

    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      path: 'src/app.ts',
      tool: 'edit',
      partId: 'tool-a',
      messageID: 'message-1',
      additions: 3,
      deletions: 1,
      patch: '+new\n-old',
    });
    expect(getFileStats(files[1])).toEqual({ additions: 0, deletions: 2 });
  });

  test('extracts filediff and result filediff metadata', () => {
    const files = extractChangedFiles([
      toolPart({
        id: 'single',
        metadata: {
          filediff: { file: 'src/single.ts', additions: 4, deletions: 0 },
        },
      }),
      toolPart({
        id: 'multi',
        tool: 'multiedit',
        metadata: {
          results: [
            { filediff: { file: 'src/one.ts', additions: 1, deletions: 2 } },
            { filediff: { file: 'src/two.ts', additions: 5, deletions: 6 } },
          ],
        },
      }),
    ]);

    expect(files.map((file) => file.path)).toEqual(['src/single.ts', 'src/one.ts', 'src/two.ts']);
    expect(files.map(getFileStats)).toEqual([
      { additions: 4, deletions: 0 },
      { additions: 1, deletions: 2 },
      { additions: 5, deletions: 6 },
    ]);
  });

  test('derives metadata file stats from per-file patches when counts are absent', () => {
    const files = extractChangedFiles([
      toolPart({
        id: 'tool-a',
        metadata: {
          files: [
            {
              relativePath: 'src/patched.ts',
              patch: [
                '--- a/src/patched.ts',
                '+++ b/src/patched.ts',
                '@@',
                '-old',
                '+new',
                '+another',
              ].join('\n'),
            },
          ],
        },
      }),
      toolPart({
        id: 'tool-b',
        tool: 'multiedit',
        metadata: {
          results: [
            {
              filediff: {
                file: 'src/result.ts',
                patch: [
                  '--- a/src/result.ts',
                  '+++ b/src/result.ts',
                  '@@',
                  '-removed',
                  '+added',
                ].join('\n'),
              },
            },
          ],
        },
      }),
    ]);

    expect(files.map((file) => file.path)).toEqual(['src/patched.ts', 'src/result.ts']);
    expect(files.map(getFileStats)).toEqual([
      { additions: 2, deletions: 1 },
      { additions: 1, deletions: 1 },
    ]);
  });

  test('falls back to input paths and patch stats', () => {
    const files = extractChangedFiles([
      toolPart({
        id: 'path',
        tool: 'write',
        input: { file_path: 'src/input.ts' },
      }),
      toolPart({
        id: 'patch',
        tool: 'apply_patch',
        metadata: {
          patch: [
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@',
            '-old',
            '+new',
            '+another',
          ].join('\n'),
        },
      }),
    ]);

    expect(files.map((file) => file.path)).toEqual(['src/input.ts', 'Diff']);
    expect(getFileStats(files[1])).toEqual({ additions: 2, deletions: 1 });
    expect(isSyntheticDiffFile(files[0])).toBe(false);
    expect(isSyntheticDiffFile(files[1])).toBe(true);
  });

  test('ignores non-edit tools and unfinished tool calls', () => {
    const files = extractChangedFiles([
      toolPart({
        id: 'read',
        tool: 'read',
        input: { filePath: 'src/read.ts' },
      }),
      toolPart({
        id: 'pending',
        status: 'pending',
        input: { filePath: 'src/pending.ts' },
      }),
      toolPart({
        id: 'running',
        status: 'running',
        input: { filePath: 'src/running.ts' },
      }),
    ]);

    expect(files).toEqual([]);
  });
});

describe('toRelativePath', () => {
  test('strips the base directory from a child path', () => {
    expect(toRelativePath('/home/user/project/src/app.ts', '/home/user/project')).toBe('src/app.ts');
  });

  test('tolerates a trailing slash on the base directory', () => {
    expect(toRelativePath('/home/user/project/src/app.ts', '/home/user/project/')).toBe('src/app.ts');
  });

  test('does not treat a sibling directory sharing a prefix as a child', () => {
    expect(toRelativePath('/home/user/project-old/src/app.ts', '/home/user/project')).toBe(
      '/home/user/project-old/src/app.ts',
    );
  });

  test('returns the path unchanged when it is outside the base directory', () => {
    expect(toRelativePath('/etc/hosts', '/home/user/project')).toBe('/etc/hosts');
  });
});
