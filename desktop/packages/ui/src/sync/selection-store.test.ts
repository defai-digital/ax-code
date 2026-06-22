import { describe, expect, test } from "vitest"

import { mergePersistedSelectionState } from "./selection-store"

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
      ["session-1", { providerId: "new-provider", modelId: "new-model" }],
      ["session-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }],
    ])
    expect(merged.sessionAgentSelections).toEqual([
      ["session-1", "new-agent"],
      ["session-2", "legacy-agent-2"],
    ])
    expect(merged.sessionAgentModelSelections).toEqual([
      [
        "session-1",
        [
          ["legacy-agent", { providerId: "legacy-provider", modelId: "legacy-model" }],
          ["new-agent", { providerId: "new-provider", modelId: "new-model" }],
        ],
      ],
      ["session-2", [["legacy-agent-2", { providerId: "legacy-provider-2", modelId: "legacy-model-2" }]]],
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
})
