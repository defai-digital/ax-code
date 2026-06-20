import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url)
const {
  collectOpenPathCandidates,
  normalizeCandidate,
} = require('./open-paths.js')

describe('normalizeCandidate', () => {
  test('resolves relative paths against cwd', () => {
    expect(normalizeCandidate('repo', {
      cwd: '/Users/example/work',
      platform: 'darwin',
    })).toBe('/Users/example/work/repo')
  })

  test('decodes file urls', () => {
    expect(normalizeCandidate('file:///Users/example/My%20Repo', {
      cwd: '/tmp',
      platform: 'darwin',
    })).toBe('/Users/example/My Repo')
  })

  test('rejects flags, non-file urls, and the app executable', () => {
    expect(normalizeCandidate('--inspect', {
      cwd: '/tmp',
      platform: 'darwin',
    })).toBeNull()
    expect(normalizeCandidate('https://example.com/repo', {
      cwd: '/tmp',
      platform: 'darwin',
    })).toBeNull()
    expect(normalizeCandidate('/Applications/AX Code.app/Contents/MacOS/AX Code', {
      cwd: '/tmp',
      platform: 'darwin',
      appExecutablePath: '/Applications/AX Code.app/Contents/MacOS/AX Code',
    })).toBeNull()
  })
})

describe('collectOpenPathCandidates', () => {
  test('deduplicates candidates with platform path semantics', () => {
    expect(collectOpenPathCandidates([
      'C:\\Users\\Example\\Repo',
      'c:\\Users\\Example\\Repo',
      '--enable-logging',
      'nested',
    ], {
      cwd: 'C:\\Users\\Example',
      platform: 'win32',
      appExecutablePath: 'C:\\Program Files\\AX Code\\AX Code.exe',
    })).toEqual([
      'C:\\Users\\Example\\Repo',
      'C:\\Users\\Example\\nested',
    ])
  })
})
