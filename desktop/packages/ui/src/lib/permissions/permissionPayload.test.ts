import { describe, expect, test } from "vitest"

import { getPermissionAlwaysPatterns, normalizePermissionName, normalizePermissionPatterns } from "./permissionPayload"

describe("permission payload normalization", () => {
  test("keeps valid pattern arrays", () => {
    expect(normalizePermissionPatterns(["/dev/*", "/tmp/*"])).toEqual(["/dev/*", "/tmp/*"])
  })

  test("converts scalar and object-shaped patterns without throwing", () => {
    expect(normalizePermissionPatterns("/dev/*")).toEqual(["/dev/*"])
    expect(normalizePermissionPatterns({ pattern: "/var/*" })).toEqual(["/var/*"])
    expect(normalizePermissionPatterns([{ path: "/tmp/*" }, "bash *"])).toEqual(["/tmp/*", "bash *"])
  })

  test("deduplicates flattened patterns", () => {
    expect(normalizePermissionPatterns(["/dev/*", ["/dev/*", "/tmp/*"]])).toEqual(["/dev/*", "/tmp/*"])
  })

  test("falls back to metadata always patterns", () => {
    expect(getPermissionAlwaysPatterns({ always: { pattern: "/dev/*" }, metadata: {} })).toEqual(["/dev/*"])
    expect(getPermissionAlwaysPatterns({ always: null, metadata: { always: { value: "bash *" } } })).toEqual([
      "bash *",
    ])
  })

  test("normalizes invalid permission names to unknown", () => {
    expect(normalizePermissionName("external_directory")).toBe("external_directory")
    expect(normalizePermissionName(null)).toBe("unknown")
  })
})
