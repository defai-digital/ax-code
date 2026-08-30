import { describe, expect, test } from "vitest"
import type { ActionResult, ComputerAction } from "../src/action"
import { ComputerUseError } from "../src/errors"
import type { ComputerUseProvider, ObserveScope, PassiveObserveOptions, ProviderCapabilities } from "../src/provider"
import { ComputerSession } from "../src/session"
import type { AppInfo, ComputerObservation } from "../src/types"

function observation(provider: string, elementIds: string[]): ComputerObservation {
  return {
    platform: "test",
    provider,
    timestamp: Date.now(),
    elements: elementIds.map((id) => ({ id })),
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakeProvider implements ComputerUseProvider {
  disposed = false
  readonly acts: ComputerAction[] = []
  readonly observedScopes: ObserveScope[] = []
  readonly observedOptions: Array<PassiveObserveOptions | undefined> = []

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

  async observe(scope: ObserveScope, options?: PassiveObserveOptions): Promise<ComputerObservation> {
    this.observedScopes.push(scope)
    this.observedOptions.push(options)
    return observation(this.name, this.elementIds)
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

  test("failover succeeds even when the old provider's dispose throws", async () => {
    // routing already switched to `next` by the time dispose runs — a
    // teardown failure on the old provider must not abort the failover
    const primary = new FakeProvider("primary", ["a"])
    primary.dispose = async () => {
      throw new Error("teardown failed")
    }
    const next = new FakeProvider("next", ["x"])
    const session = new ComputerSession(primary)
    await session.observe({ app: "TextEdit" })

    const fresh = await session.failover(next)
    expect(fresh.provider).toBe("next")
    expect(fresh.elements.map((element) => element.id)).toEqual(["e2:x"])
    expect(session.activeProvider).toBe(next)
    await session.act({ type: "click", target: { kind: "point", x: 1, y: 1 } })
    expect(next.acts).toHaveLength(1)
    expect(primary.acts).toHaveLength(0)
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

    expect(first.elements[0]!.id).toBe("e1:a")
    expect(second.elements[0]!.id).toBe("e2:b")

    await expect(
      session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target" })
    await session.act({ type: "click", target: { kind: "element", id: second.elements[0]!.id } })
    expect(primary.acts[0]).toEqual({ type: "click", target: { kind: "element", id: "b" } })
  })

  test("a new observation invalidates a reused raw element id", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)

    const first = await session.observe({ desktop: true })
    const second = await session.observe({ desktop: true })

    expect(first.elements[0]!.id).toBe("e1:a")
    expect(second.elements[0]!.id).toBe("e2:a")
    await expect(
      session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target" })
    await session.act({ type: "click", target: { kind: "element", id: second.elements[0]!.id } })
    expect(primary.acts).toEqual([{ type: "click", target: { kind: "element", id: "a" } }])
  })

  test("a failed observation preserves the current epoch and element map", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })
    const observe = primary.observe.bind(primary)
    primary.observe = async () => {
      throw new Error("observe failed")
    }

    await expect(session.observe({ app: "Broken" })).rejects.toThrow("observe failed")
    await session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } })

    primary.observe = observe
    const second = await session.observe({ desktop: true })
    expect(second.elements[0]!.id).toBe("e2:a")
    expect(primary.acts).toEqual([{ type: "click", target: { kind: "element", id: "a" } }])
  })

  test("an empty observation still invalidates ids from the prior observation", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })

    primary.elementIds.length = 0
    const empty = await session.observe({ desktop: true })
    expect(empty.elements).toEqual([])
    await expect(
      session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target" })

    primary.elementIds.push("a")
    const third = await session.observe({ desktop: true })
    expect(third.elements[0]!.id).toBe("e3:a")
  })

  test("only the first completing overlapping observation can commit", async () => {
    const primary = new FakeProvider("primary")
    const firstResult = deferred<ComputerObservation>()
    const secondResult = deferred<ComputerObservation>()
    let call = 0
    primary.observe = async (scope) => {
      primary.observedScopes.push(scope)
      return [firstResult, secondResult][call++]!.promise
    }
    const session = new ComputerSession(primary)

    const first = session.observe({ app: "First" })
    const firstRejection = expect(first).rejects.toMatchObject({ code: "superseded_observation" })
    const second = session.observe({ app: "Second" })
    secondResult.resolve(observation("primary", ["b"]))
    const current = await second
    firstResult.resolve(observation("primary", ["a"]))
    await firstRejection

    expect(current.elements[0]!.id).toBe("e1:b")
    await session.act({ type: "click", target: { kind: "element", id: current.elements[0]!.id } })
    expect(primary.acts).toEqual([{ type: "click", target: { kind: "element", id: "b" } }])
  })

  test("an observation in flight across an act is superseded", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })

    const pendingResult = deferred<ComputerObservation>()
    primary.observe = async (scope) => {
      primary.observedScopes.push(scope)
      return pendingResult.promise
    }
    const pending = session.observe({ desktop: true })
    const pendingRejection = expect(pending).rejects.toMatchObject({ code: "superseded_observation" })

    // The act mutates the UI while the observation is in flight; the
    // pre-action snapshot must not commit as the current epoch.
    await session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } })
    pendingResult.resolve(observation("primary", ["a"]))
    await pendingRejection

    primary.observe = FakeProvider.prototype.observe.bind(primary)
    const fresh = await session.observe({ desktop: true })
    expect(fresh.elements[0]!.id).toBe("e2:a")
    await session.act({ type: "click", target: { kind: "element", id: fresh.elements[0]!.id } })
    expect(primary.acts).toHaveLength(2)
  })

  test("failover to the active provider re-observes without disposing it", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ app: "TextEdit" })
    const staleId = first.elements[0]!.id

    const fresh = await session.failover(primary)

    expect(primary.disposed).toBe(false)
    expect(fresh.provider).toBe("primary")
    expect(fresh.elements[0]!.id).toBe("e2:a")
    expect(primary.observedScopes).toEqual([{ app: "TextEdit" }, { app: "TextEdit" }])
    await expect(session.act({ type: "click", target: { kind: "element", id: staleId } })).rejects.toMatchObject({
      code: "stale_target",
    })
    await session.act({ type: "click", target: { kind: "element", id: fresh.elements[0]!.id } })
    expect(primary.acts).toHaveLength(1)
  })

  test("a late observation from the old provider cannot overwrite failover state", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const next = new FakeProvider("next", ["x"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })
    const lateResult = deferred<ComputerObservation>()
    primary.observe = async (scope) => {
      primary.observedScopes.push(scope)
      return lateResult.promise
    }

    const late = session.observe({ app: "Stale" })
    const lateRejection = expect(late).rejects.toMatchObject({
      code: "superseded_observation",
      provider: "primary",
    })
    const fresh = await session.failover(next)
    lateResult.resolve(observation("primary", ["late"]))
    await lateRejection

    expect(fresh.elements[0]!.id).toBe("e2:x")
    await expect(
      session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target", provider: "next" })
    await session.act({ type: "click", target: { kind: "element", id: fresh.elements[0]!.id } })
    expect(next.acts).toEqual([{ type: "click", target: { kind: "element", id: "x" } }])
  })

  test("a failed replacement observation keeps pre-failover ids invalid", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const next = new FakeProvider("next", ["x"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })
    const observe = next.observe.bind(next)
    next.observe = async () => {
      throw new Error("replacement observe failed")
    }

    await expect(session.failover(next)).rejects.toThrow("replacement observe failed")
    expect(session.activeProvider).toBe(next)
    await expect(
      session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } }),
    ).rejects.toMatchObject({ code: "stale_target", provider: "next" })

    next.observe = observe
    const recovered = await session.observe({ desktop: true })
    expect(recovered.elements[0]!.id).toBe("e2:x")
  })

  test("a failover superseded during disposal cannot observe the newer provider", async () => {
    const primary = new FakeProvider("primary")
    const middle = new FakeProvider("middle", ["m"])
    const current = new FakeProvider("current", ["c"])
    const releaseDispose = deferred<void>()
    primary.dispose = () => releaseDispose.promise
    const session = new ComputerSession(primary)

    const superseded = session.failover(middle)
    const supersededRejection = expect(superseded).rejects.toMatchObject({
      code: "superseded_observation",
      provider: "middle",
    })
    const fresh = await session.failover(current)
    releaseDispose.resolve(undefined)
    await supersededRejection

    expect(session.activeProvider).toBe(current)
    expect(middle.observedScopes).toEqual([])
    expect(fresh.elements[0]!.id).toBe("e1:c")
    await session.act({ type: "click", target: { kind: "element", id: fresh.elements[0]!.id } })
    expect(current.acts).toEqual([{ type: "click", target: { kind: "element", id: "c" } }])
  })

  test("an observation committed during disposal supersedes the pending failover result", async () => {
    const primary = new FakeProvider("primary")
    const next = new FakeProvider("next", ["x"])
    const releaseDispose = deferred<void>()
    primary.dispose = () => releaseDispose.promise
    const session = new ComputerSession(primary)

    const failover = session.failover(next)
    const failoverRejection = expect(failover).rejects.toMatchObject({
      code: "superseded_observation",
      provider: "next",
    })
    const fresh = await session.observe({ app: "Concurrent" })
    releaseDispose.resolve(undefined)
    await failoverRejection

    expect(session.activeProvider).toBe(next)
    expect(next.observedScopes).toEqual([{ app: "Concurrent" }])
    expect(fresh.elements[0]!.id).toBe("e1:x")
    await session.act({ type: "click", target: { kind: "element", id: fresh.elements[0]!.id } })
    expect(next.acts).toEqual([{ type: "click", target: { kind: "element", id: "x" } }])
  })

  test("a rejected act on a stale target must not supersede an in-flight observe", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const pendingResult = deferred<ComputerObservation>()
    primary.observe = async (scope) => {
      primary.observedScopes.push(scope)
      return pendingResult.promise
    }
    const pending = session.observe({ desktop: true })

    // This id was never issued by an observation, so resolveAction throws
    // before the provider is ever called: the UI never changes.
    await expect(session.act({ type: "click", target: { kind: "element", id: "e999:bogus" } })).rejects.toMatchObject({
      code: "stale_target",
    })

    pendingResult.resolve(observation("primary", ["a"]))
    const committed = await pending
    expect(committed.elements[0]!.id).toBe("e1:a")
    expect(primary.acts).toHaveLength(0)
  })

  test("observePassive does not advance the epoch or invalidate prior ids", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const first = await session.observe({ desktop: true })
    expect(first.elements[0]!.id).toBe("e1:a")

    const passive = await session.observePassive({ desktop: true }, { sinceRevision: null })
    expect(primary.observedOptions.at(-1)).toEqual({ sinceRevision: null })
    // Legacy providers may still return elements; they must not be stamped
    // as a new epoch and must not replace the current map.
    expect(passive.elements.map((element) => element.id)).toEqual(["a"])

    await session.act({ type: "click", target: { kind: "element", id: first.elements[0]!.id } })
    expect(primary.acts).toEqual([{ type: "click", target: { kind: "element", id: "a" } }])
  })

  test("observePassive does not supersede an in-flight targetable observe", async () => {
    const primary = new FakeProvider("primary", ["a"])
    const session = new ComputerSession(primary)
    const pendingResult = deferred<ComputerObservation>()
    primary.observe = async (scope, options) => {
      primary.observedScopes.push(scope)
      primary.observedOptions.push(options)
      if (options) return observation("primary", ["passive"])
      return pendingResult.promise
    }

    const pending = session.observe({ desktop: true })
    await session.observePassive({ desktop: true }, { sinceRevision: null })
    pendingResult.resolve(observation("primary", ["a"]))
    const committed = await pending
    expect(committed.elements[0]!.id).toBe("e1:a")
    await session.act({ type: "click", target: { kind: "element", id: committed.elements[0]!.id } })
    expect(primary.acts).toEqual([{ type: "click", target: { kind: "element", id: "a" } }])
  })
})
