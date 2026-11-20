import { describe, expect, test } from "vitest"
import {
  buildKeyBindingsMap,
  defaultKeyAliases,
  getKeyBindingKey,
  mergeKeyBindings,
  type KeyBinding,
} from "../src/lib/keybinding.internal.js"

describe("key bindings map construction", () => {
  test("a custom return binding wins over the default enter alias", () => {
    const defaults: KeyBinding[] = [{ name: "enter", action: "default-submit" }]
    const custom: KeyBinding[] = [{ name: "return", action: "custom-submit" }]
    const map = buildKeyBindingsMap(mergeKeyBindings(defaults, custom), defaultKeyAliases)

    expect(map.get(getKeyBindingKey({ name: "return" }))).toBe("custom-submit")
    expect(map.get(getKeyBindingKey({ name: "enter" }))).toBe("default-submit")
  })

  test("multi-hop aliases resolve every name along the chain", () => {
    const map = buildKeyBindingsMap([{ name: "kpenter", action: "submit" }], defaultKeyAliases)

    for (const name of ["kpenter", "enter", "return"]) {
      expect(map.get(getKeyBindingKey({ name }))).toBe("submit")
    }
  })

  test("alias cycles terminate and still bind every name in the cycle", () => {
    const map = buildKeyBindingsMap([{ name: "a", action: "cycle" }], { a: "b", b: "a" })

    expect(map.get(getKeyBindingKey({ name: "a" }))).toBe("cycle")
    expect(map.get(getKeyBindingKey({ name: "b" }))).toBe("cycle")
  })

  test("modifier flags stay part of every alias key", () => {
    const map = buildKeyBindingsMap([{ name: "enter", action: "submit", ctrl: true }], defaultKeyAliases)

    expect(map.get(getKeyBindingKey({ name: "return", ctrl: true }))).toBe("submit")
    expect(map.get(getKeyBindingKey({ name: "return" }))).toBeUndefined()
  })

  test("prototype-key names do not fabricate alias entries", () => {
    const map = buildKeyBindingsMap([{ name: "toString", action: "custom" }])

    expect(map.size).toBe(1)
    expect(map.get(getKeyBindingKey({ name: "toString" }))).toBe("custom")
  })

  test("an explicit alias map still resolves prototype-key aliases", () => {
    const map = buildKeyBindingsMap([{ name: "constructor", action: "build" }], { constructor: "build-key" })

    expect(map.size).toBe(2)
    expect(map.get(getKeyBindingKey({ name: "constructor" }))).toBe("build")
    expect(map.get(getKeyBindingKey({ name: "build-key" }))).toBe("build")
  })
})