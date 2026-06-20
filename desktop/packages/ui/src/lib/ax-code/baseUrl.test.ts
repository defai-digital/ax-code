import { describe, expect, test } from 'vitest';

import { buildAxCodeApiUrl, normalizeAxCodeSdkBaseUrl } from './baseUrl';

describe('normalizeAxCodeSdkBaseUrl', () => {
  test('keeps API-root base URLs unchanged', () => {
    expect(normalizeAxCodeSdkBaseUrl('/api')).toBe('/api');
    expect(normalizeAxCodeSdkBaseUrl('http://localhost:3001/api')).toBe('http://localhost:3001/api');
  });

  test('strips a stale config resource suffix from SDK base URLs', () => {
    expect(normalizeAxCodeSdkBaseUrl('/api/config')).toBe('/api');
    expect(normalizeAxCodeSdkBaseUrl('/api/config/')).toBe('/api');
    expect(normalizeAxCodeSdkBaseUrl('http://localhost:3001/api/config')).toBe('http://localhost:3001/api');
    expect(normalizeAxCodeSdkBaseUrl('http://localhost:3001/api/config/')).toBe('http://localhost:3001/api');
  });
});

describe('buildAxCodeApiUrl', () => {
  test('does not duplicate /api when the base URL already points at the API root', () => {
    expect(buildAxCodeApiUrl('/api', '/api/fs/list')).toBe('/api/fs/list');
    expect(buildAxCodeApiUrl('http://127.0.0.1:53397/api', '/api/fs/home')).toBe(
      'http://127.0.0.1:53397/api/fs/home'
    );
  });

  test('joins non-api-root bases with API endpoints', () => {
    expect(buildAxCodeApiUrl('', '/api/fs/list')).toBe('/api/fs/list');
    expect(buildAxCodeApiUrl('http://127.0.0.1:53397', '/api/fs/list')).toBe(
      'http://127.0.0.1:53397/api/fs/list'
    );
  });
});
