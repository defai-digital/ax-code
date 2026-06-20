import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url)
const {
  GITHUB_BUG_REPORT_URL,
  GITHUB_FEATURE_REQUEST_URL,
} = require('./support-urls.js')

describe('support URLs', () => {
  test('points issue templates at the AX Code repository', () => {
    expect(GITHUB_BUG_REPORT_URL).toBe(
      'https://github.com/defai-digital/ax-code/issues/new?template=bug_report.yml',
    )
    expect(GITHUB_FEATURE_REQUEST_URL).toBe(
      'https://github.com/defai-digital/ax-code/issues/new?template=feature_request.yml',
    )
  })
})
