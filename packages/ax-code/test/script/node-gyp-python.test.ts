import { describe, expect, test } from "vitest"
import { resolveLegacyNodeGypPython } from "../../script/node-gyp-python"

describe("resolveLegacyNodeGypPython", () => {
  test("skips Python versions that cannot run the legacy node-gyp bundled with node-pty", () => {
    const versions: Record<string, string | undefined> = {
      python3: "3.14",
      python311: "3.11",
    }

    expect(
      resolveLegacyNodeGypPython({
        candidates: ["python3", "python311"],
        inspect: (candidate) => versions[candidate],
      }),
    ).toBe("python311")
  })

  test("returns undefined when no compatible interpreter is installed", () => {
    expect(
      resolveLegacyNodeGypPython({
        candidates: ["missing", "python3"],
        inspect: (candidate) => (candidate === "python3" ? "3.12" : undefined),
      }),
    ).toBeUndefined()
  })

  test("accepts the supported Python version range", () => {
    for (const version of ["3.8", "3.9", "3.10", "3.11"]) {
      expect(resolveLegacyNodeGypPython({ candidates: [version], inspect: () => version })).toBe(version)
    }
  })
})
