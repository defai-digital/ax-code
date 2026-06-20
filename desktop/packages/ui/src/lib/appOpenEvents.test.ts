import { describe, expect, test } from 'vitest';
import {
  applyOpenProjectPathToStore,
  parseOpenDraftSessionEvent,
  parseOpenProjectEvent,
  parseOpenSessionEvent,
} from './appOpenEvents';

describe('app open event parsers', () => {
  test('parses open-session detail', () => {
    expect(parseOpenSessionEvent(new CustomEvent('open', {
      detail: { sessionId: ' session-1 ', directory: ' /repo ' },
    }))).toEqual({
      sessionId: 'session-1',
      directory: '/repo',
    });
  });

  test('rejects open-session without a session id', () => {
    expect(parseOpenSessionEvent(new CustomEvent('open', {
      detail: { directory: '/repo' },
    }))).toBeNull();
    expect(parseOpenSessionEvent(new Event('open'))).toBeNull();
  });

  test('parses open-draft-session detail with nullable fields', () => {
    expect(parseOpenDraftSessionEvent(new CustomEvent('open', {
      detail: { directory: ' ', projectId: ' project-1 ' },
    }))).toEqual({
      directory: null,
      projectId: 'project-1',
    });
  });

  test('parses open-project detail', () => {
    expect(parseOpenProjectEvent(new CustomEvent('open', {
      detail: { projectPath: ' /repo ' },
    }))).toEqual({ projectPath: '/repo' });
  });

  test('rejects open-project without a project path', () => {
    expect(parseOpenProjectEvent(new CustomEvent('open', {
      detail: { projectPath: '' },
    }))).toBeNull();
    expect(parseOpenProjectEvent(new CustomEvent('open', {
      detail: null,
    }))).toBeNull();
  });
});

describe('applyOpenProjectPathToStore', () => {
  test('activates an existing normalized project instead of adding a duplicate', () => {
    const activated: string[] = [];
    const added: string[] = [];

    const result = applyOpenProjectPathToStore('/repo/', {
      projects: [{ id: 'project-repo', path: '/repo' }],
      validateProjectPath: (path) => ({
        ok: true,
        normalizedPath: path.replace(/\/+$/, ''),
      }),
      setActiveProject: (id) => {
        activated.push(id);
      },
      addProject: (path) => {
        added.push(path);
        return { id: 'new-project', path };
      },
    });

    expect(result).toBe('project-repo');
    expect(activated).toEqual(['project-repo']);
    expect(added).toEqual([]);
  });

  test('adds a new project using the normalized path', () => {
    const activated: string[] = [];
    const added: string[] = [];

    const result = applyOpenProjectPathToStore('/new-repo/', {
      projects: [{ id: 'project-repo', path: '/repo' }],
      validateProjectPath: (path) => ({
        ok: true,
        normalizedPath: path.replace(/\/+$/, ''),
      }),
      setActiveProject: (id) => {
        activated.push(id);
      },
      addProject: (path) => {
        added.push(path);
        return { id: 'new-project', path };
      },
    });

    expect(result).toBe('new-project');
    expect(activated).toEqual([]);
    expect(added).toEqual(['/new-repo']);
  });

  test('ignores invalid project paths', () => {
    const added: string[] = [];

    const result = applyOpenProjectPathToStore('', {
      projects: [],
      validateProjectPath: () => ({ ok: false }),
      setActiveProject: () => {
        throw new Error('setActiveProject should not be called');
      },
      addProject: (path) => {
        added.push(path);
        return { id: 'new-project', path };
      },
    });

    expect(result).toBeNull();
    expect(added).toEqual([]);
  });
});
