import { beforeEach, describe, expect, test } from "vitest"

import { mergePersistedSelectionState, touchCappedMruEntry, useSelectionStore } from "./selection-store"

beforeEach(() => {
  useSelectionStore.setState({
    sessionModelSelections: new Map(),
    sessionAgentSelections: new Map(),
    sessionAgentModelSelections: new Map(),
    lastUsedProvider: null,
  })
})

describe("mergePersistedSelectionState", () => {
  test("fills missing selection-store entries from legacy context-store state", () => {
    const merged = mergePersistedSelectionState(
      {
        sessionModelSelections: [["session-1", { providerId: "new-provider", modelId: "new-model" }]],
        sessionAgentSelections: [["session-1", "new-agent"]],
        sessionAgentModelSelections: [
          ["session-1", [["new-agent", { providerId: "new-provider", modelId: "new-model" }]]],
        ],
        lastUsedProvider: { providerID: "explicit-provider", modelID: "explicit-model" },
      },
      {
        sessionModelSelections: [
          ["session-1", { providerId: "legacy-provider", modelId: "legacy-model" }],
          ["session-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }],
        ],
        sessionAgentSelections: [
          ["session-1", "legacy-agent"],
          ["session-2", "legacy-agent-2"],
        ],
        sessionAgentModelSelections: [
          ["session-1", [["legacy-agent", { providerId: "legacy-provider", modelId: "legacy-model" }]]],
          ["session-2", [["legacy-agent-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }]]],
        ],
      },
    )

    expect(merged.sessionModelSelections).toEqual([
      ["session-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }],
      ["session-1", { providerId: "new-provider", modelId: "new-model" }],
    ])
    expect(merged.sessionAgentSelections).toEqual([
      ["session-2", "legacy-agent-2"],
      ["session-1", "new-agent"],
    ])
    expect(merged.sessionAgentModelSelections).toEqual([
      ["session-2", [["legacy-agent-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }]]],
      [
        "session-1",
        [
          ["legacy-agent", { providerId: "legacy-provider", modelId: "legacy-model" }],
          ["new-agent", { providerId: "new-provider", modelId: "new-model" }],
        ],
      ],
    ])
    expect(merged.lastUsedProvider).toEqual({ providerID: "explicit-provider", modelID: "explicit-model" })
  })

  test("derives last used provider from legacy model selections when no explicit value exists", () => {
    const merged = mergePersistedSelectionState(undefined, {
      sessionModelSelections: [
        ["session-1", { providerId: "provider-1", modelId: "model-1" }],
        ["session-2", { providerId: "provider-2", modelId: "model-2" }],
      ],
    })

    expect(merged.lastUsedProvider).toEqual({ providerID: "provider-2", modelID: "model-2" })
  })

  test("derives last used provider from the newest primary selection after a legacy merge", () => {
    const merged = mergePersistedSelectionState(
      {
        sessionModelSelections: [["session-1", { providerId: "current-provider", modelId: "current-model" }]],
      },
      {
        sessionModelSelections: [
          ["session-1", { providerId: "legacy-provider-1", modelId: "legacy-model-1" }],
          ["session-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }],
        ],
      },
    )

    expect(merged.lastUsedProvider).toEqual({ providerID: "current-provider", modelID: "current-model" })
  })

  test("caps oversized hydrated maps to the most recent 150 sessions", () => {
    const sessionModelSelections = Array.from({ length: 151 }, (_, index) => [
      `session-${index}`,
      { providerId: "provider", modelId: `model-${index}` },
    ]) as [string, { providerId: string; modelId: string }][]
    const sessionAgentSelections = sessionModelSelections.map(
      ([sessionId], index) => [sessionId, `agent-${index}`] as [string, string],
    )
    const sessionAgentModelSelections = sessionModelSelections.map(
      ([sessionId], index) =>
        [sessionId, [[`agent-${index}`, { providerId: "provider", modelId: `model-${index}` }]]] as [
          string,
          [string, { providerId: string; modelId: string }][],
        ],
    )

    const merged = mergePersistedSelectionState(
      { sessionModelSelections, sessionAgentSelections, sessionAgentModelSelections },
      undefined,
    )

    expect(merged.sessionModelSelections).toHaveLength(150)
    expect(merged.sessionAgentSelections).toHaveLength(150)
    expect(merged.sessionAgentModelSelections).toHaveLength(150)
    expect(merged.sessionModelSelections[0]?.[0]).toBe("session-1")
    expect(merged.sessionAgentSelections[0]?.[0]).toBe("session-1")
    expect(merged.sessionAgentModelSelections[0]?.[0]).toBe("session-1")
  })
})

describe("selection-store MRU limits", () => {
  test("caps maps while moving an updated key to the newest position", () => {
    const values = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ])

    touchCappedMruEntry(values, "a", 4, 3)
    touchCappedMruEntry(values, "d", 5, 3)

    expect([...values.entries()]).toEqual([
      ["c", 3],
      ["a", 4],
      ["d", 5],
    ])
  })

  test("keeps only 150 in-memory sessions and preserves a revisited selection", () => {
    const store = useSelectionStore.getState()
    for (let index = 0; index < 150; index += 1) {
      const sessionId = "session-" + index
      store.saveSessionModelSelection(sessionId, "provider", "model")
      store.saveSessionAgentSelection(sessionId, "build")
      store.saveAgentModelForSession(sessionId, "build", "provider", "model")
    }

    store.saveSessionAgentSelection("session-0", "build")
    store.saveAgentModelForSession("session-0", "build", "provider", "model")
    store.saveSessionModelSelection("session-150", "provider", "model")
    store.saveSessionAgentSelection("session-150", "build")
    store.saveAgentModelForSession("session-150", "build", "provider", "model")

    const state = useSelectionStore.getState()
    expect(state.sessionModelSelections.size).toBe(150)
    expect(state.sessionAgentSelections.size).toBe(150)
    expect(state.sessionAgentModelSelections.size).toBe(150)
    expect(state.sessionModelSelections.has("session-0")).toBe(false)
    expect(state.sessionAgentSelections.has("session-0")).toBe(true)
    expect(state.sessionAgentSelections.has("session-1")).toBe(false)
    expect(state.sessionAgentModelSelections.has("session-0")).toBe(true)
    expect(state.sessionAgentModelSelections.has("session-1")).toBe(false)
  })
})
