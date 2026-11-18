import { expect, test, vi } from "vitest"
import { mergeConfig, migrateDeprecatedModeIntoAgent } from "../../src/config/merge-policy"
import { restrictUntrustedConfig, tightenIsolationFloor } from "../../src/config/untrusted-policy"
import { evaluate } from "../../src/permission/evaluate"

vi.mock("../../src/config/config", () => {
  throw new Error("policy loaded the config runtime")
})

vi.mock("../../src/config/config-impl", () => {
  throw new Error("policy loaded the config loader")
})
vi.mock("../../src/config/schema", () => {
  throw new Error("policy loaded the config schema")
})
vi.mock("../../src/project/instance", () => {
  throw new Error("policy loaded the instance runtime")
})

test("configuration policies operate on data without loading config, schema or instance services", () => {
  const denied = { read: "deny", edit: "allow" }
  const input = Object.freeze({
    permission: Object.freeze(denied),
    agent: Object.freeze({ build: Object.freeze({ permission: Object.freeze(denied) }) }),
    mode: Object.freeze({ review: Object.freeze({ permission: Object.freeze(denied) }) }),
    shell: "/project/chosen-shell",
    isolation: Object.freeze({ mode: "workspace-write" as const, protected: Object.freeze(["project-secret"]) }),
  })
  const restricted = restrictUntrustedConfig(input)
  expect(restricted.permission).toEqual({ read: "deny" })
  expect(restricted.agent).toEqual({ build: { permission: { read: "deny" } } })
  expect(restricted.mode).toEqual({ review: { permission: { read: "deny" } } })
  expect(restricted.shell).toBeUndefined()
  expect(input.permission.edit).toBe("allow")
  expect(input.shell).toBe("/project/chosen-shell")

  const floor = { isolation: { mode: "read-only" as const, protected: ["global-secret"] } }
  const incoming = { isolation: { mode: "workspace-write" as const, protected: ["project-secret"] } }
  const merged = mergeConfig(floor, tightenIsolationFloor(floor, incoming))
  expect(merged.isolation).toEqual({ mode: "read-only", protected: ["global-secret", "project-secret"] })
  expect(incoming.isolation.mode).toBe("workspace-write")

  const legacy = migrateDeprecatedModeIntoAgent({ mode: { review: { model: "provider/older-model" } } })
  expect(mergeConfig(legacy, { agent: { review: { model: "provider/newer-model" } } }).agent?.review).toEqual({
    mode: "primary",
    model: "provider/newer-model",
  })
})

test.each(["constructor", "toString", "hasOwnProperty"])(
  "an authority layer preserves an earlier denial for the %s pattern",
  (pattern) => {
    const merged = mergeConfig(
      { permission: { read: { "*": "ask", [pattern]: "deny" } } },
      { permission: { read: { "README.md": "allow" } } },
      { authority: true },
    )
    const read = merged.permission?.read
    if (!read || typeof read === "string") throw new Error("Expected read permission patterns")
    const rules = Object.entries(read).map(([pattern, action]) => ({ permission: "read", pattern, action }))
    expect(evaluate("read", pattern, rules).action).toBe("deny")
    expect(evaluate("read", "README.md", rules).action).toBe("allow")
  },
)
