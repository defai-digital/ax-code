import { describe, expect, test } from 'vitest';
import type { Part } from '@ax-code/sdk/v2/client';

import { sortPartsById } from './part-ordering';

describe('sortPartsById', () => {
  test('drops parts without ids and sorts by id', () => {
    const parts = [
      { id: 'part-c', type: 'text' },
      { type: 'text' },
      { id: 'part-a', type: 'text' },
      { id: 'part-b', type: 'tool' },
    ] as Part[];

    expect(sortPartsById(parts).map((part) => part.id)).toEqual(['part-a', 'part-b', 'part-c']);
  });

  test('can skip caller-provided part types', () => {
    const parts = [
      { id: 'part-a', type: 'text' },
      { id: 'part-b', type: 'patch' },
      { id: 'part-c', type: 'tool' },
    ] as Part[];

    expect(sortPartsById(parts, new Set(['patch'])).map((part) => part.id)).toEqual(['part-a', 'part-c']);
  });
});
