import { afterEach, expect, test } from "vitest"
import { clearEnvCache, env, envRegistry, registerEnvVar } from "../src/lib/env.js"

const NAME = "AX_TUI_TEST_NUMBER_PARSE"

registerEnvVar({ name: NAME, description: "test number parsing", type: "number", default: 7 })

afterEach(() => {
  delete process.env[NAME]
  clearEnvCache()
})

test("empty number env var is rejected instead of parsed as zero", () => {
  process.env[NAME] = ""
  expect(() => env[NAME]).toThrow(/valid number/)
})

test("whitespace-only number env var is rejected", () => {
  process.env[NAME] = "   "
  expect(() => env[NAME]).toThrow(/valid number/)
})

test("valid number env var is parsed", () => {
  process.env[NAME] = "42"
  expect(env[NAME]).toBe(42)
})

test("zero is a valid number env var", () => {
  process.env[NAME] = "0"
  expect(env[NAME]).toBe(0)
})

test("unset number env var falls back to its default", () => {
  expect(env[NAME]).toBe(7)
})


test("non-finite number env vars are rejected", () => {
  process.env[NAME] = "Infinity"
  expect(() => env[NAME]).toThrow(/valid number/)
  clearEnvCache()
  process.env[NAME] = "-Infinity"
  expect(() => env[NAME]).toThrow(/valid number/)
})

test("prototype keys are not treated as registered env vars", () => {
  expect("constructor" in env).toBe(false)
  expect(() => env["constructor"]).toThrow(/not registered/)
})

test("env vars can be registered with prototype-colliding names", () => {
  registerEnvVar({ name: "hasOwnProperty", description: "prototype collision probe", type: "string", default: "ok" })
  try {
    expect("hasOwnProperty" in env).toBe(true)
    expect(env["hasOwnProperty"]).toBe("ok")
  } finally {
    delete envRegistry.hasOwnProperty
    clearEnvCache()
  }
})

test("prototype-colliding names without defaults are treated as unset", () => {
  registerEnvVar({ name: "toString", description: "prototype collision probe", type: "string" })
  try {
    expect(() => env["toString"]).toThrow(/not set/)
  } finally {
    delete envRegistry.toString
    clearEnvCache()
  }
})

test("prototype-colliding boolean env vars use their default", () => {
  registerEnvVar({ name: "valueOf", description: "prototype collision probe", type: "boolean", default: false })
  try {
    expect(env["valueOf"]).toBe(false)
  } finally {
    delete envRegistry.valueOf
    clearEnvCache()
  }
})
