import { describe, expect, test } from 'vitest';

import {
  areSliceDepsEqual,
  createLiveSnapshotMemo,
  getSessionSliceDeps,
  getSessionStatusSliceDeps,
  getStatusOnlySliceDeps,
} from '../live-selector-memo'

type FakeState = {
  session: { id: string }[]
  session_status?: Record<string, { type: string }>
  part?: Record<string, unknown[]>
}

const makeState = (overrides: Partial<FakeState> = {}): FakeState => ({
  session: [],
  session_status: {},
  part: {},
  ...overrides,
})

describe('areSliceDepsEqual', () => {
  test('compares element-wise by reference', () => {
    const slice = { a: 1 }
    expect(areSliceDepsEqual([slice], [slice])).toBe(true)
    expect(areSliceDepsEqual([slice], [{ a: 1 }])).toBe(false)
    expect(areSliceDepsEqual([slice], [slice, slice])).toBe(false)
    expect(areSliceDepsEqual([], [])).toBe(true)
    expect(areSliceDepsEqual([undefined], [undefined])).toBe(true)
  })
})

describe('slice deps extractors', () => {
  test('extract the slices each selector family reads', () => {
    const stateA = makeState({ session: [{ id: 'a' }], session_status: { a: { type: 'busy' } } })
    const stateB = makeState({ session: [{ id: 'b' }] })

    expect(getSessionSliceDeps([stateA, stateB])).toEqual([stateA.session, stateB.session])
    expect(getStatusOnlySliceDeps([stateA, stateB])).toEqual([stateA.session_status, stateB.session_status])
    expect(getSessionStatusSliceDeps([stateA, stateB])).toEqual([
      stateA.session_status,
      stateA.session,
      stateB.session_status,
      stateB.session,
    ])
  })
})

describe('createLiveSnapshotMemo', () => {
  test('skips the selector entirely when slice deps are unchanged', () => {
    let selectorRuns = 0
    const snapshot = createLiveSnapshotMemo<FakeState[], string[]>({
      selector: (states) => {
        selectorRuns += 1
        return states.flatMap((state) => state.session.map((session) => session.id))
      },
      isEqual: (left, right) => left.join() === right.join(),
      getDeps: getSessionSliceDeps,
    })

    const state = makeState({ session: [{ id: 'a' }] })
    const first = snapshot([state])
    expect(first).toEqual(['a'])
    expect(selectorRuns).toBe(1)

    // Simulates a message.part.updated event: new state object, same
    // session slice reference — the selector must not run again.
    const streamed: FakeState = { ...state, part: { m1: [{}] } }
    expect(snapshot([streamed])).toBe(first)
    expect(snapshot([streamed])).toBe(first)
    expect(selectorRuns).toBe(1)
  })

  test('recomputes when a watched slice reference changes', () => {
    let selectorRuns = 0
    const snapshot = createLiveSnapshotMemo<FakeState[], number>({
      selector: (states) => {
        selectorRuns += 1
        return states.reduce((count, state) => count + state.session.length, 0)
      },
      isEqual: Object.is,
      getDeps: getSessionSliceDeps,
    })

    const state = makeState({ session: [{ id: 'a' }] })
    expect(snapshot([state])).toBe(1)
    const updated: FakeState = { ...state, session: [...state.session, { id: 'b' }] }
    expect(snapshot([updated])).toBe(2)
    expect(selectorRuns).toBe(2)
  })

  test('recomputes when a store is added or removed', () => {
    let selectorRuns = 0
    const snapshot = createLiveSnapshotMemo<FakeState[], number>({
      selector: (states) => {
        selectorRuns += 1
        return states.length
      },
      isEqual: Object.is,
      getDeps: getSessionSliceDeps,
    })

    const stateA = makeState()
    const stateB = makeState()
    expect(snapshot([stateA])).toBe(1)
    expect(snapshot([stateA, stateB])).toBe(2)
    expect(snapshot([stateA])).toBe(1)
    expect(selectorRuns).toBe(3)
  })

  test('preserves the previous reference when isEqual reports equivalence', () => {
    const snapshot = createLiveSnapshotMemo<FakeState[], string[]>({
      selector: (states) => states.flatMap((state) => state.session.map((session) => session.id)),
      isEqual: (left, right) => left.join() === right.join(),
      getDeps: getSessionSliceDeps,
    })

    const first = snapshot([makeState({ session: [{ id: 'a' }] })])
    // Different slice reference with equivalent content: selector runs, but
    // the cached reference is kept so subscribers skip re-renders.
    const second = snapshot([makeState({ session: [{ id: 'a' }] })])
    expect(second).toBe(first)
  })

  test('works without a deps extractor (result-equality only)', () => {
    let selectorRuns = 0
    const snapshot = createLiveSnapshotMemo<FakeState[], number>({
      selector: (states) => {
        selectorRuns += 1
        return states.length
      },
      isEqual: Object.is,
    })

    const state = makeState()
    expect(snapshot([state])).toBe(1)
    expect(snapshot([state])).toBe(1)
    expect(selectorRuns).toBe(2)
  })
})
