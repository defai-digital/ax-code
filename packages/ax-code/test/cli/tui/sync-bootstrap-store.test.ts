import { describe, expect, test } from "bun:test"
import {
  applyProviderBootstrapState,
  createProviderBootstrapFailure,
  createProviderBootstrapSuccess,
  mergeBootstrapSessions,
  normalizeBootstrapList,
  normalizeBootstrapRecord,
  normalizeBootstrapSessionBuckets,
  normalizeBootstrapValue,
} from "../../../src/cli/cmd/tui/context/sync-bootstrap-store"

describe("tui sync bootstrap store", () => {
  test("merges fetched sessions without dropping event-arrived sessions", () => {
    const existing = [
      { id: "ses_1", title: "existing" },
      { id: "ses_3", title: "event" },
    ]
    const fetched = [
      { id: "ses_1", title: "fresh" },
      { id: "ses_2", title: "fetched" },
    ]

    expect(mergeBootstrapSessions(existing, fetched)).toEqual([
      { id: "ses_1", title: "fresh" },
      { id: "ses_2", title: "fetched" },
      { id: "ses_3", title: "event" },
    ])
  })

  test("creates provider bootstrap success state", () => {
    expect(
      createProviderBootstrapSuccess({
        providers: [{ id: "anthropic" }],
        default: { chat: "anthropic" },
      }),
    ).toEqual({
      provider: [{ id: "anthropic" }],
      provider_default: { chat: "anthropic" },
      provider_loaded: true,
      provider_failed: false,
    })
  })

  test("creates provider bootstrap failure state", () => {
    expect(createProviderBootstrapFailure()).toEqual({
      provider_loaded: true,
      provider_failed: true,
    })
  })

  test("applies provider bootstrap states through a single store helper", () => {
    const store = {
      provider: [{ id: "baseline" }],
      provider_default: { chat: "baseline" },
      provider_loaded: false,
      provider_failed: false,
    }

    applyProviderBootstrapState(
      store,
      createProviderBootstrapSuccess({
        providers: [{ id: "anthropic" }],
        default: { chat: "anthropic" },
      }),
    )

    expect(store).toEqual({
      provider: [{ id: "anthropic" }],
      provider_default: { chat: "anthropic" },
      provider_loaded: true,
      provider_failed: false,
    })

    applyProviderBootstrapState(store, createProviderBootstrapFailure())

    expect(store).toEqual({
      provider: [{ id: "anthropic" }],
      provider_default: { chat: "anthropic" },
      provider_loaded: true,
      provider_failed: true,
    })
  })

  test("normalizes missing bootstrap lists to empty arrays", () => {
    expect(normalizeBootstrapList(undefined)).toEqual([])
    expect(normalizeBootstrapList([{ id: "cmd_1" }])).toEqual([{ id: "cmd_1" }])
  })

  test("normalizes missing bootstrap records to empty objects", () => {
    expect(normalizeBootstrapRecord(undefined)).toEqual({})
    expect(normalizeBootstrapRecord({ key: "value" })).toEqual({ key: "value" })
  })

  test("preserves bootstrap fallback values when payload data is missing", () => {
    expect(normalizeBootstrapValue(undefined, { current: "keep" })).toEqual({ current: "keep" })
    expect(normalizeBootstrapValue({ current: "next" }, { current: "keep" })).toEqual({ current: "next" })
  })

  test("groups bootstrap session-scoped requests by session id", () => {
    expect(
      normalizeBootstrapSessionBuckets([
        { id: "req_1", sessionID: "ses_1" },
        { id: "req_2", sessionID: "ses_2" },
        { id: "req_3", sessionID: "ses_1" },
      ]),
    ).toEqual({
      ses_1: [
        { id: "req_1", sessionID: "ses_1" },
        { id: "req_3", sessionID: "ses_1" },
      ],
      ses_2: [{ id: "req_2", sessionID: "ses_2" }],
    })
  })
})
