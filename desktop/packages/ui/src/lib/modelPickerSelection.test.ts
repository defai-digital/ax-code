// @vitest-environment node

import { describe, expect, test } from "vitest"

import {
  getNextSelectableFavoriteModel,
  getNextSelectableModelPickerIndex,
  normalizeModelPickerSelectionIndex,
} from "./modelPickerSelection"
import type { ProviderWithModelList } from "../types/providerModels"

const selectable = (id: string) => ({ model: { id } })
const blocked = (id: string) => ({ model: { id, options: { memoryBlockReason: "Requires more memory" } } })

describe("model picker selection", () => {
  test("normalizes initial selection to the first selectable model", () => {
    const entries = [blocked("blocked-a"), selectable("ready-b"), selectable("ready-c")]

    expect(normalizeModelPickerSelectionIndex(entries, 0)).toBe(1)
  })

  test("keyboard navigation skips blocked models", () => {
    const entries = [selectable("ready-a"), blocked("blocked-b"), selectable("ready-c")]

    expect(getNextSelectableModelPickerIndex(entries, 0, 1)).toBe(2)
    expect(getNextSelectableModelPickerIndex(entries, 2, -1)).toBe(0)
  })

  test("returns no selection when every model is blocked", () => {
    const entries = [blocked("blocked-a"), blocked("blocked-b")]

    expect(normalizeModelPickerSelectionIndex(entries, 0)).toBe(-1)
    expect(getNextSelectableModelPickerIndex(entries, 0, 1)).toBe(-1)
  })

  test("favorite model cycling skips blocked favorites", () => {
    const providers = [
      {
        id: "local",
        models: [
          { id: "ready-a" },
          { id: "blocked-b", options: { memoryBlockReason: "Requires more memory" } },
          { id: "ready-c" },
        ],
      },
    ] as unknown as ProviderWithModelList[]
    const favorites = [
      { providerID: "local", modelID: "ready-a" },
      { providerID: "local", modelID: "blocked-b" },
      { providerID: "local", modelID: "ready-c" },
    ]

    expect(getNextSelectableFavoriteModel(favorites, providers, "local", "ready-a", 1)).toEqual({
      providerID: "local",
      modelID: "ready-c",
    })
    expect(getNextSelectableFavoriteModel(favorites, providers, "local", "blocked-b", 1)).toEqual({
      providerID: "local",
      modelID: "ready-c",
    })
    expect(getNextSelectableFavoriteModel(favorites, providers, "local", "blocked-b", -1)).toEqual({
      providerID: "local",
      modelID: "ready-a",
    })
  })
})
