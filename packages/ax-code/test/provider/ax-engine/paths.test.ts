import path from "node:path"
import { describe, expect, test } from "vitest"
import { AX_ENGINE_MODEL_IDS, AX_ENGINE_QUANTIZATION_IDS } from "../../../src/provider/ax-engine/constants"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"

describe("AxEnginePaths", () => {
  test("keeps managed model and binary paths inside their cache roots", () => {
    expect(AxEnginePaths.managedModelDir(AX_ENGINE_MODEL_IDS[0], AX_ENGINE_QUANTIZATION_IDS[0])).toBe(
      path.join(AxEnginePaths.models, AX_ENGINE_MODEL_IDS[0], AX_ENGINE_QUANTIZATION_IDS[0]),
    )
    expect(AxEnginePaths.managedBinaryDir("7.6.0")).toBe(path.join(AxEnginePaths.bin, "7.6.0"))
  })

  test("rejects managed path traversal", () => {
    expect(() => AxEnginePaths.managedModelDir(AX_ENGINE_MODEL_IDS[0], "../../outside")).toThrow(
      "AX Engine path escapes its managed directory",
    )
    expect(() => AxEnginePaths.managedBinaryDir("../outside")).toThrow("AX Engine path escapes its managed directory")
    expect(() => AxEnginePaths.managedBinaryDir(path.resolve(path.parse(AxEnginePaths.bin).root, "outside"))).toThrow(
      "AX Engine path escapes its managed directory",
    )
  })
})
