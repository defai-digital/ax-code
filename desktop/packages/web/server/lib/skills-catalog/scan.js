import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';

import { assertGitAvailable, cloneRepo, looksLikeAuthError, runGit } from './git.js';
import { parseSkillRepoSource } from './source.js';
import { safeRm, toRepoFsPath, validateSkillName } from './shared.js';

function parseSkillMd(content) {
  const text = typeof content === 'string' ? content : '';
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      ok: true,
      frontmatter: {},
      warnings: ['Invalid SKILL.md: missing YAML frontmatter delimiter'],
    };
  }

  try {
    const frontmatter = yaml.parse(match[1]) || {};
    return { ok: true, frontmatter, warnings: [] };
  } catch {
    return {
      ok: true,
      frontmatter: {},
      warnings: ['Invalid SKILL.md: failed to parse YAML frontmatter'],
    };
  }
}

export async function scanSkillsRepository({
  source,
  subpath,
  defaultSubpath,
  identity,
} = {}) {
  const gitCheck = await assertGitAvailable();
  if (!gitCheck.ok) {
    return { ok: false, error: gitCheck.error };
  }

  const parsed = parseSkillRepoSource(source, { subpath });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const effectiveSubpath = parsed.effectiveSubpath || (typeof defaultSubpath === 'string' && defaultSubpath.trim() ? defaultSubpath.trim() : null);
  const cloneUrl = identity?.sshKey ? parsed.cloneUrlSsh : parsed.cloneUrlHttps;

  const tempBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'openchamber-skills-scan-'));

  try {
    const cloned = await cloneRepo({ cloneUrl, identity, tempDir: tempBase });
    if (!cloned.ok) {
      const msg = `${cloned.error?.stderr || ''}\n${cloned.error?.message || ''}`.trim();
      if (looksLikeAuthError(msg)) {
        return { ok: false, error: { kind: 'authRequired', message: 'Authentication required to access this repository', sshOnly: true } };
      }
      return { ok: false, error: { kind: 'networkError', message: msg || 'Failed to clone repository' } };
    }

    const patterns = effectiveSubpath
      ? [`${effectiveSubpath}/SKILL.md`, `${effectiveSubpath}/**/SKILL.md`]
      : ['SKILL.md', '**/SKILL.md'];

    let skillMdPaths = null;

    // Fast path: sparse checkout only SKILL.md files, then parse from disk.
    // This avoids one `git show` per skill.
    const sparseInit = await runGit(['-C', tempBase, 'sparse-checkout', 'init', '--no-cone'], { identity, timeoutMs: 15_000 });
    if (sparseInit.ok) {
      const sparseSet = await runGit(['-C', tempBase, 'sparse-checkout', 'set', ...patterns], { identity, timeoutMs: 30_000 });
      if (sparseSet.ok) {
        const checkout = await runGit(['-C', tempBase, 'checkout', '--force', 'HEAD'], { identity, timeoutMs: 60_000 });
        if (checkout.ok) {
          const lsFiles = await runGit(['-C', tempBase, 'ls-files'], { identity, timeoutMs: 15_000 });
          if (lsFiles.ok) {
            skillMdPaths = lsFiles.stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .filter((p) => p.endsWith('/SKILL.md') || p === 'SKILL.md');
          }
        }
      }
    }

    // Fallback: list tree and read SKILL.md blobs via git.
    if (!Array.isArray(skillMdPaths)) {
      const listArgs = ['-C', tempBase, 'ls-tree', '-r', '--name-only', 'HEAD'];
      if (effectiveSubpath) {
        listArgs.push('--', effectiveSubpath);
      }

      const listResult = await runGit(listArgs, { identity, timeoutMs: 30_000 });
      if (!listResult.ok) {
        // If subpath doesn't exist, treat as empty scan.
        return {
          ok: true,
          normalizedRepo: parsed.normalizedRepo,
          effectiveSubpath,
          items: [],
        };
      }

      skillMdPaths = listResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((p) => p.endsWith('/SKILL.md') || p === 'SKILL.md');
    }

    // Root-level SKILL.md doesn't map cleanly to AX Code's "skill name == folder name" convention.
    const uniqueSkillDirs = Array.from(
      new Set(
        skillMdPaths
          .filter((p) => p !== 'SKILL.md')
          .map((p) => path.posix.dirname(p))
      )
    );

    const items = [];
    const maxParallel = 10;
    let idx = 0;

    const worker = async () => {
      while (idx < uniqueSkillDirs.length) {
        const skillDir = uniqueSkillDirs[idx++];
        const skillName = path.posix.basename(skillDir);
        const skillMdPath = path.posix.join(skillDir, 'SKILL.md');

        const warnings = [];
        let skillMdContent = '';

        // Prefer filesystem reads when sparse checkout succeeded.
        const filePath = toRepoFsPath(tempBase, skillMdPath);
        try {
          skillMdContent = await fs.promises.readFile(filePath, 'utf8');
        } catch {
          const showResult = await runGit(['-C', tempBase, 'show', `HEAD:${skillMdPath}`], { identity, timeoutMs: 15_000 });
          if (!showResult.ok) {
            warnings.push('Failed to read SKILL.md');
          } else {
            skillMdContent = showResult.stdout;
          }
        }

        const parsedMd = parseSkillMd(skillMdContent);
        warnings.push(...(parsedMd.warnings || []));

        const description = typeof parsedMd.frontmatter?.description === 'string' ? parsedMd.frontmatter.description : undefined;
        const frontmatterName = typeof parsedMd.frontmatter?.name === 'string' ? parsedMd.frontmatter.name : undefined;

        const installable = validateSkillName(skillName);
        if (!installable) {
          warnings.push('Skill directory name is not a valid AX Code skill name');
        }

        items.push({
          repoSource: source,
          repoSubpath: effectiveSubpath || undefined,
          skillDir,
          skillName,
          frontmatterName,
          description,
          installable,
          warnings: warnings.length ? warnings : undefined,
        });
      }
    };

    await Promise.all(Array.from({ length: Math.min(maxParallel, uniqueSkillDirs.length || 1) }, () => worker()));

    // Stable ordering for UX
    items.sort((a, b) => a.skillName.localeCompare(b.skillName));

    return {
      ok: true,
      normalizedRepo: parsed.normalizedRepo,
      effectiveSubpath,
      items,
    };
  } finally {
    await safeRm(tempBase);
  }
}
