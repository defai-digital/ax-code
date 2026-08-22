import { describe, expect, test } from "vitest"
import type { ActionResult, ComputerAction } from "../src/action"
import { ComputerUseError } from "../src/errors"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../src/provider"
import { ComputerSession } from "../src/session"
import type { AppInfo, ComputerObservation } from "../src/types"

class FakeProvider implements ComputerUseProvider {
  disposed = false
  readonly acts: ComputerAction[] = []
  readonly observedScopes: ObserveScope[] = []

  constructor(
    readonly name: string,
    readonly elementIds: string[] = [],
  ) {}

  capabilities(): ProviderCapabilities {
    return { actions: ["click"], backgroundDelivery: false, elementTargeting: true, windowActivation: true }
  }

  async listApps(): Promise<AppInfo[]> {
    return [{ name: `${this.name}-app` }]
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    this.observedScopes.push(scope)
    return {
      platform: "test",
      provider: this.name,
      timestamp: Date.now(),
      elements: this.elementIds.map((id) => ({ id })),
    }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    this.acts.push(action)
    return { ok: true, provider: this.name, action: action.type }
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

describe("ComputerSession", () => {
  test("acts route to the active provider", async () => {
    const primary = new FakeProvider("primary")
    const session = new ComputerSession(primary)
    const result = await session.act({ type: "click", target: { kind: "point", x: 1, y: 2 } })
    expect(result).toEqual({ ok: true, provider: "primary", action: "click" })
    expect(primary.acts).toHaveLength(1)
  })

  test("observe stamps element ids with the observation epoch", async () => {
    const primary = new FakeProvider("primary", ["a", "b"])
    const session = new ComputerSession(primary)
    const observation = await session.observe({ desktop: true })
    expect(observation.elements.map((element) => element.id)).toEqual(["e1:a", "e1:b"])
  })

  test("act resolves session element ids back to raw provider ids", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const observation = await session.observe({ desktop: true })
    const stamped = observation.elements[0]
    expect(stamped).toBeDefined()
    await session.act({ type: "click", target: { kind: "element", id: stamped!.id } })
    expect(primary.acts[0]).toEqual({ type: "click", target: { kind: "element", id: "a" } })
  })

  test("failover disposes the old provider and re-observes the same scope on the new one", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const next = new FakeProvider("next", ["x"])
    const session = new ComputerSession(primary)

    await session.observe({ app: "TextEdit" })
    const fresh = await session.failover(next)

    expect(primary.disposed).toBe(true)
    expect(next.observedScopes).toEqual([{ app: "TextEdit" }])
    expect(fresh.provider).toBe("next")
    expect(fresh.elements.map((element) => element.id)).toEqual(["e2:x"])
    expect(session.activeProvider).toBe(next)

    await session.act({ type: "click", target: { kind: "point", x: 1, y: 1 } })
    expect(primary.acts).toHaveLength(0)
    expect(next.acts).toHaveLength(1)
  })

  test("failover without a prior observe uses the desktop scope", async () => {
    const primary = new FakeProvider("primary")
    const next = new FakeProvider("next")
    const session = new ComputerSession(primary)
    await session.failover(next)
    expect(next.observedScopes).toEqual([{ desktop: true }])
  })

  test("element ids from before a failover are rejected as stale", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const next = new FakeProvider("next", ["x"])
    const session = new ComputerSession(primary)

    const before = await session.observe({ desktop: true })
    const staleId = before.elements[0]!.id
    await session.failover(next)

    const act = session.act({ type: "click", target: { kind: "element", id: staleId } })
    await expect(act).rejects.toBeInstanceOf(ComputerUseError)
    await expect(act).rejects.toMatchObject({ code: "stale_target", provider: "next" })
    expect(next.acts).toHaveLength(0)
  })

  test("a raw id colliding across epochs is still rejected after failover", async () => {
    // both providers expose an element with the same raw id "a"; the epoch
    // namespace must still keep the pre-failover id from resolving
    const primary = new FakeProvider("primary", ["a"])
    const next = new FakeProvider("next", ["a"])
    const session = new ComputerSession(primary)

    const before = await session.observe({ desktop: true })
    await session.failover(next)
    await expect(
      session.act({ type: "click", target: { kind: "element", id: before.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target" })
  })

  test("element acts without any prior observe are rejected", async () => {
    const session = new ComputerSession(new FakeProvider("primary", ["a"]))
    await expect(session.act({ type: "click", target: { kind: "element", id: "e1:a" } })).rejects.toMatchObject({
      code: "stale_target",
    })
  })

  test("point acts without a prior observe follow the provider contract", async () => {
    const primary = new FakeProvider("primary")
    const session = new ComputerSession(primary)
    const result = await session.act({ type: "click", target: { kind: "point", x: 3, y: 4 } })
    expect(result.ok).toBe(true)
    expect(primary.acts).toHaveLength(1)
  })

  test("a new observe replaces the valid element set", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })
    primary.elementIds.length = 0
    primary.elementIds.push("b")
    const second = await session.observe({ desktop: true })

    await expect(
      session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target" })
    await session.act({ type: "click", target: { kind: "element", id: second.elements[0]!.id } })
    expect(primary.acts[0]).toEqual({ type: "click", target: { kind: "element", id: "b" } })
  })
})
