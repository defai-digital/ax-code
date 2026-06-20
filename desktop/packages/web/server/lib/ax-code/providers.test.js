import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getProviderSources } from './providers.js';

let tmpDir = null;

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('getProviderSources', () => {
  it('ignores malformed project config layers while reporting other sources', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-code-provider-sources-'));
    fs.writeFileSync(path.join(tmpDir, 'ax-code.jsonc'), '{ provider: {', 'utf8');

    const result = getProviderSources('anthropic', tmpDir);

    expect(result.sources.project).toMatchObject({
      exists: false,
      path: path.join(tmpDir, 'ax-code.jsonc'),
    });
  });
});
