import { describe, expect, test } from "bun:test"
import {
  normalizeDebugEngineState,
  normalizeIsolationState,
  normalizeRuntimeFlagState,
} from "../../../src/cli/cmd/tui/context/sync-runtime-store"

describe("tui sync runtime store", () => {
  test("normalizes legacy debug-engine payloads with missing optional fields", () => {
    expect(
      normalizeDebugEngineState({
        count: 2,
        plans: [
          {
            planId: "plan_1",
            kind: "refactor",
            risk: "low",
            summary: "small cleanup",
            affectedFileCount: 1,
            affectedSymbolCount: 2,
            timeCreated: 123,
          },
        ],
      }),
    ).toEqual({
      pendingPlans: 2,
      plans: [
        {
          planId: "plan_1",
          kind: "refactor",
          risk: "low",
          summary: "small cleanup",
          affectedFileCount: 1,
          affectedSymbolCount: 2,
          timeCreated: 123,
        },
      ],
      toolCount: 0,
      graph: {
        nodeCount: 0,
        edgeCount: 0,
        lastIndexedAt: null,
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      },
    })
  })

  test("preserves explicit debug-engine graph fields", () => {
    expect(
      normalizeDebugEngineState({
        count: 0,
        plans: [],
        toolCount: 4,
        graph: {
          nodeCount: 10,
          edgeCount: 20,
          lastIndexedAt: 456,
          state: "failed",
          completed: 3,
          total: 7,
          error: "index failed",
        },
      }),
    ).toEqual({
      pendingPlans: 0,
      plans: [],
      toolCount: 4,
      graph: {
        nodeCount: 10,
        edgeCount: 20,
        lastIndexedAt: 456,
        state: "failed",
        completed: 3,
        total: 7,
        error: "index failed",
      },
    })
  })

  test("normalizes runtime boolean flag payloads", () => {
    expect(normalizeRuntimeFlagState({ enabled: true })).toBe(true)
    expect(normalizeRuntimeFlagState({ enabled: false })).toBe(false)
  })

  test("normalizes isolation payloads without changing allowed fields", () => {
    expect(normalizeIsolationState({ mode: "workspace-write", network: true })).toEqual({
      mode: "workspace-write",
      network: true,
    })
  })
})
