import { describe, expect, it } from 'vitest';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ensureProjectAxCodeResourceDirs,
  ensureProjectConfigPath,
  getConfigPaths,
  getConfigEntitySources,
  getPrimaryUserConfigPath,
  getProjectConfigCandidates,
  getUserConfigPaths,
  resolveAxCodeConfigDir,
  resolveProjectAxCodeResourcePath,
} from './shared.js';

describe('shared ax-code resource paths', () => {
  it('returns each config candidate once', () => {
    const workingDirectory = path.join(os.tmpdir(), 'openchamber-config-candidates');

    const projectCandidates = getProjectConfigCandidates(workingDirectory);
    expect(new Set(projectCandidates).size).toBe(projectCandidates.length);

    const userPaths = getConfigPaths(workingDirectory).userPaths;
    expect(new Set(userPaths).size).toBe(userPaths.length);
  });

  it('supports active config directories without duplicating plugin path logic', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-config-paths-'));
    const customConfigPath = path.join(tempRoot, 'custom', 'ax-code.json');

    try {
      expect(resolveAxCodeConfigDir(customConfigPath)).toBe(path.dirname(customConfigPath));

      const userPaths = getUserConfigPaths(path.dirname(customConfigPath));
      expect(userPaths).toEqual([
        path.join(tempRoot, 'custom', 'config.json'),
        path.join(tempRoot, 'custom', 'ax-code.json'),
        path.join(tempRoot, 'custom', 'ax-code.jsonc'),
      ]);
      expect(getPrimaryUserConfigPath(userPaths, userPaths[0])).toBe(userPaths[0]);

      await fsPromises.mkdir(path.dirname(userPaths[1]), { recursive: true });
      await fsPromises.writeFile(userPaths[1], '{}', 'utf8');
      expect(getPrimaryUserConfigPath(userPaths, userPaths[0])).toBe(userPaths[1]);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates the project config directory for writers', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-project-config-'));

    try {
      const configPath = ensureProjectConfigPath(tempRoot);

      expect(configPath).toBe(path.join(tempRoot, '.ax-code', 'ax-code.json'));
      expect((await fsPromises.stat(path.dirname(configPath))).isDirectory()).toBe(true);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('prefers legacy project resources only when the primary path is absent', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-resource-paths-'));
    const primaryPath = path.join(tempRoot, '.ax-code', 'commands', 'demo.md');
    const legacyPath = path.join(tempRoot, '.ax-code', 'command', 'demo.md');

    try {
      await fsPromises.mkdir(path.dirname(legacyPath), { recursive: true });
      await fsPromises.writeFile(legacyPath, 'legacy', 'utf8');

      expect(resolveProjectAxCodeResourcePath(
        tempRoot,
        ['commands', 'demo.md'],
        ['command', 'demo.md'],
      )).toBe(legacyPath);

      await fsPromises.mkdir(path.dirname(primaryPath), { recursive: true });
      await fsPromises.writeFile(primaryPath, 'primary', 'utf8');

      expect(resolveProjectAxCodeResourcePath(
        tempRoot,
        ['commands', 'demo.md'],
        ['command', 'demo.md'],
      )).toBe(primaryPath);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates both primary and legacy project resource directories', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-resource-dirs-'));

    try {
      const primaryDir = ensureProjectAxCodeResourceDirs(tempRoot, 'skills', 'skill');

      expect(primaryDir).toBe(path.join(tempRoot, '.ax-code', 'skills'));
      expect((await fsPromises.stat(primaryDir)).isDirectory()).toBe(true);
      expect((await fsPromises.stat(path.join(tempRoot, '.ax-code', 'skill'))).isDirectory()).toBe(true);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('shared config entity sources', () => {
  it('summarizes markdown sources with project precedence', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-entity-md-'));
    const userPath = path.join(tempRoot, 'user', 'demo.md');
    const projectPath = path.join(tempRoot, '.ax-code', 'commands', 'demo.md');

    try {
      await fsPromises.mkdir(path.dirname(userPath), { recursive: true });
      await fsPromises.mkdir(path.dirname(projectPath), { recursive: true });
      await fsPromises.writeFile(userPath, '---\ndescription: User\n---\nUser body', 'utf8');
      await fsPromises.writeFile(projectPath, '---\ndescription: Project\n---\nProject body', 'utf8');

      const sources = getConfigEntitySources({
        workingDirectory: tempRoot,
        entityName: 'demo',
        sectionKey: 'command',
        bodyField: 'template',
        scopes: { USER: 'user', PROJECT: 'project' },
        getProjectPath: (_workingDirectory, entityName) => path.join(tempRoot, '.ax-code', 'commands', `${entityName}.md`),
        getUserPath: (entityName) => path.join(tempRoot, 'user', `${entityName}.md`),
      });

      expect(sources.md).toEqual({
        exists: true,
        path: projectPath,
        scope: 'project',
        fields: ['description', 'template'],
      });
      expect(sources.projectMd).toEqual({ exists: true, path: projectPath });
      expect(sources.userMd).toEqual({ exists: true, path: userPath });
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('summarizes project JSON sources when no markdown file exists', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-entity-json-'));
    const configPath = path.join(tempRoot, '.ax-code', 'ax-code.json');

    try {
      await fsPromises.mkdir(path.dirname(configPath), { recursive: true });
      await fsPromises.writeFile(
        configPath,
        JSON.stringify({ command: { demo: { description: 'Project JSON', template: 'Run it' } } }),
        'utf8',
      );

      const sources = getConfigEntitySources({
        workingDirectory: tempRoot,
        entityName: 'demo',
        sectionKey: 'command',
        bodyField: 'template',
        scopes: { USER: 'user', PROJECT: 'project' },
        getProjectPath: (_workingDirectory, entityName) => path.join(tempRoot, '.ax-code', 'commands', `${entityName}.md`),
        getUserPath: (entityName) => path.join(tempRoot, 'user', `${entityName}.md`),
      });

      expect(sources.md.exists).toBe(false);
      expect(sources.json).toEqual({
        exists: true,
        path: configPath,
        scope: 'project',
        fields: ['description', 'template'],
      });
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
