import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"

import { ProviderConcurrencyGovernor } from "../../src/provider/concurrency-governor"
import { currentLockHost } from "../../src/util/process-lock"
import { tmpdir } from "../fixture/fixture"

// White-box helpers: the cross-process tests fabricate foreign lease files in
// the same directory layout the governor uses, so a single in-process test
// run can exercise the machine-wide layer deterministically.
function leaseDirFor(stateRoot: string, providerID: string): string {
  const hash = createHash("sha256").update(providerID).digest("hex").slice(0, 16)
  return path.join(stateRoot, "provider-slots", hash)
}

async function writeForeignLease(dir: string, body: Record<string, unknown> = {}): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `foreign-${Math.random().toString(36).slice(2)}.json`)
  await fs.writeFile(
    file,
    JSON.stringify({
      // Own PID on the same host is always "live" to the liveness probe, so
      // the fabricated lease reliably blocks until we remove it.
      pid: process.pid,
      host: currentLockHost(),
      acquiredAt: Date.now(),
      ttlMs: 60_000,
      ...body,
    }),
  )
  return file
}

async function listLeases(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch(() => [])
}

function tick(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const ENV_LIMIT = ProviderConcurrencyGovernor.ENV_LIMIT

describe("ProviderConcurrencyGovernor", () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    ProviderConcurrencyGovernor.resetForTests()
    savedEnv = process.env[ENV_LIMIT]
    delete process.env[ENV_LIMIT]
  })

  afterEach(() => {
    ProviderConcurrencyGovernor.resetForTests()
    vi.restoreAllMocks()
    if (savedEnv === undefined) delete process.env[ENV_LIMIT]
    else process.env[ENV_LIMIT] = savedEnv
  })

  describe("in-process semaphore (layer 1)", () => {
    test("admits up to the limit immediately and queues the next acquire until a slot releases", async () => {
      const providerID = "gateway-a"
      const slotA = await ProviderConcurrencyGovernor.acquire({ providerID, limit: 2, crossProcess: false })
      const slotB = await ProviderConcurrencyGovernor.acquire({ providerID, limit: 2, crossProcess: false })
      expect(slotA).toBeDefined()
      expect(slotB).toBeDefined()

      let resolved = false
      const pending = ProviderConcurrencyGovernor.acquire({ providerID, limit: 2, crossProcess: false }).then(
        (slot) => {
          resolved = true
          return slot
        },
      )
      await tick()
      expect(resolved).toBe(false)

      slotA[Symbol.dispose]()
      const slotC = await pending
      expect(resolved).toBe(true)

      slotB[Symbol.dispose]()
      slotC[Symbol.dispose]()
    })

    test("resolves queued acquires in FIFO order", async () => {
      const providerID = "gateway-fifo"
      const slotA = await ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false })
      const order: string[] = []
      const acquireTracked = (tag: string) =>
        ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false }).then((slot) => {
          order.push(tag)
          return slot
        })
      const pB = acquireTracked("B")
      const pC = acquireTracked("C")
      const pD = acquireTracked("D")
      await tick()
      expect(order).toEqual([])

      slotA[Symbol.dispose]()
      const slotB = await pB
      slotB[Symbol.dispose]()
      const slotC = await pC
      slotC[Symbol.dispose]()
      const slotD = await pD
      slotD[Symbol.dispose]()
      expect(order).toEqual(["B", "C", "D"])
    })

    test("an aborted queued acquire rejects with AbortError and does not block later waiters", async () => {
      const providerID = "gateway-abort"
      const slotA = await ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false })
      const controller = new AbortController()
      const pB = ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        crossProcess: false,
        signal: controller.signal,
      })
      const pC = ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false })
      await tick()

      controller.abort()
      const err = await pB.then(
        () => {
          throw new Error("expected pB to reject")
        },
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(DOMException)
      expect((err as DOMException).name).toBe("AbortError")

      // The aborted waiter left the queue; the follower still gets the slot.
      slotA[Symbol.dispose]()
      const slotC = await pC
      slotC[Symbol.dispose]()
    })

    test("removes the abort listener when a queued acquire resolves normally instead of aborting", async () => {
      const providerID = "gateway-listener-cleanup"
      const controller = new AbortController()
      const addSpy = vi.spyOn(controller.signal, "addEventListener")
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener")

      const slotA = await ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false })
      const pending = ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        crossProcess: false,
        signal: controller.signal,
      })
      await tick()

      // Exactly one abort listener is registered while the waiter is queued,
      // and it has not been removed yet.
      expect(addSpy).toHaveBeenCalledTimes(1)
      expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true })
      expect(removeSpy).toHaveBeenCalledTimes(0)

      // A normal release-handoff resolves the waiter without firing abort;
      // the abort listener must still be removed exactly once.
      slotA[Symbol.dispose]()
      const slotB = await pending
      slotB[Symbol.dispose]()

      expect(addSpy).toHaveBeenCalledTimes(1)
      expect(removeSpy).toHaveBeenCalledTimes(1)
      expect(removeSpy).toHaveBeenCalledWith("abort", addSpy.mock.calls[0]?.[1])
    })

    test("rejects immediately when the signal is already aborted", async () => {
      const err = await ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-preaborted",
        limit: 1,
        crossProcess: false,
        signal: AbortSignal.abort(),
      }).then(
        () => {
          throw new Error("expected acquire to reject")
        },
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(DOMException)
      expect((err as DOMException).name).toBe("AbortError")
    })

    test("treats non-positive and non-finite limits as unlimited", async () => {
      for (const limit of [0, -3, Number.POSITIVE_INFINITY, Number.NaN]) {
        ProviderConcurrencyGovernor.resetForTests()
        const providerID = `gateway-unlimited-${limit}`
        const slots = await Promise.all(
          Array.from({ length: 5 }, () =>
            ProviderConcurrencyGovernor.acquire({ providerID, limit, crossProcess: false }),
          ),
        )
        expect(slots).toHaveLength(5)
        for (const slot of slots) slot[Symbol.dispose]()
      }
    })

    test("resolves the default limit from the env var, then configuredLimit, then the hardcoded default", async () => {
      // Env var wins when no explicit limit is passed.
      process.env[ENV_LIMIT] = "2"
      const envA = await ProviderConcurrencyGovernor.acquire({ providerID: "gateway-env", crossProcess: false })
      const envB = await ProviderConcurrencyGovernor.acquire({ providerID: "gateway-env", crossProcess: false })
      let envResolved = false
      const envPending = ProviderConcurrencyGovernor.acquire({ providerID: "gateway-env", crossProcess: false }).then(
        (slot) => {
          envResolved = true
          return slot
        },
      )
      await tick()
      expect(envResolved).toBe(false)
      envA[Symbol.dispose]()
      const envC = await envPending
      envB[Symbol.dispose]()
      envC[Symbol.dispose]()

      // configuredLimit applies when the env var is absent.
      delete process.env[ENV_LIMIT]
      ProviderConcurrencyGovernor.resetForTests()
      const cfgA = await ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-config",
        configuredLimit: 2,
        crossProcess: false,
      })
      const cfgB = await ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-config",
        configuredLimit: 2,
        crossProcess: false,
      })
      let cfgResolved = false
      const cfgPending = ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-config",
        configuredLimit: 2,
        crossProcess: false,
      }).then((slot) => {
        cfgResolved = true
        return slot
      })
      await tick()
      expect(cfgResolved).toBe(false)
      cfgA[Symbol.dispose]()
      const cfgC = await cfgPending
      cfgB[Symbol.dispose]()
      cfgC[Symbol.dispose]()

      // Invalid env values are ignored; the hardcoded default (8) applies.
      ProviderConcurrencyGovernor.resetForTests()
      process.env[ENV_LIMIT] = "not-a-number"
      const defaultSlots = await Promise.all(
        Array.from({ length: ProviderConcurrencyGovernor.DEFAULT_LIMIT }, () =>
          ProviderConcurrencyGovernor.acquire({ providerID: "gateway-default", crossProcess: false }),
        ),
      )
      expect(defaultSlots).toHaveLength(ProviderConcurrencyGovernor.DEFAULT_LIMIT)
      let defaultResolved = false
      const defaultPending = ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-default",
        crossProcess: false,
      }).then((slot) => {
        defaultResolved = true
        return slot
      })
      await tick()
      expect(defaultResolved).toBe(false)
      defaultSlots[0][Symbol.dispose]()
      const extra = await defaultPending
      extra[Symbol.dispose]()
      for (const slot of defaultSlots.slice(1)) slot[Symbol.dispose]()
    })
  })

  describe("cross-process lease layer (layer 2)", () => {
    test("composed lifecycle: a second in-process acquire waits at layer 1 and takes over the lease on release", async () => {
      await using tmp = await tmpdir()
      const providerID = "gateway-compose"
      const dir = leaseDirFor(tmp.path, providerID)

      const slotA = await ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
      })
      expect(await listLeases(dir)).toHaveLength(1)

      let resolved = false
      const pending = ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
      }).then((slot) => {
        resolved = true
        return slot
      })
      await tick()
      expect(resolved).toBe(false)

      slotA[Symbol.dispose]()
      const slotB = await pending
      const afterHandoff = await listLeases(dir)
      expect(afterHandoff).toHaveLength(1)
      expect(afterHandoff[0].startsWith(`${process.pid}-`)).toBe(true)

      slotB[Symbol.dispose]()
      expect(await listLeases(dir)).toHaveLength(0)
    })

    test("waits behind a live foreign lease, then fails open at the bounded deadline", async () => {
      await using tmp = await tmpdir()
      const providerID = "gateway-timeout"
      const dir = leaseDirFor(tmp.path, providerID)
      const foreign = await writeForeignLease(dir)

      const started = Date.now()
      const slot = await ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
        crossProcessTimeoutMs: 350,
      })
      const elapsed = Date.now() - started

      // Bounded wait (>= the deadline we set), then admission WITHOUT a
      // lease: the foreign holder still owns the only slot on the machine.
      expect(elapsed).toBeGreaterThanOrEqual(300)
      expect(elapsed).toBeLessThan(5_000)
      const remaining = await listLeases(dir)
      expect(remaining).toEqual([path.basename(foreign)])
      slot[Symbol.dispose]()
    })

    test("takes the slot when a live foreign lease disappears mid-wait", async () => {
      await using tmp = await tmpdir()
      const providerID = "gateway-wait-success"
      const dir = leaseDirFor(tmp.path, providerID)
      const foreign = await writeForeignLease(dir)

      const started = Date.now()
      const pending = ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
        crossProcessTimeoutMs: 5_000,
      })
      await tick(100)
      await fs.unlink(foreign)
      const slot = await pending
      expect(Date.now() - started).toBeLessThan(3_000)

      const leases = await listLeases(dir)
      expect(leases).toHaveLength(1)
      expect(leases[0].startsWith(`${process.pid}-`)).toBe(true)
      slot[Symbol.dispose]()
      expect(await listLeases(dir)).toHaveLength(0)
    })

    test("prunes a TTL-expired lease and reuses the slot", async () => {
      await using tmp = await tmpdir()
      const providerID = "gateway-stale-ttl"
      const dir = leaseDirFor(tmp.path, providerID)
      const stale = await writeForeignLease(dir, { acquiredAt: Date.now() - 60_000, ttlMs: 1_000 })

      const slot = await ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
        crossProcessTimeoutMs: 2_000,
      })
      const leases = await listLeases(dir)
      expect(leases).not.toContain(path.basename(stale))
      expect(leases).toHaveLength(1)
      expect(leases[0].startsWith(`${process.pid}-`)).toBe(true)
      slot[Symbol.dispose]()
    })

    test("prunes a dead same-host PID lease and reuses the slot", async () => {
      await using tmp = await tmpdir()
      const providerID = "gateway-stale-pid"
      const dir = leaseDirFor(tmp.path, providerID)
      // A PID far beyond any OS pid_max: kill(pid, 0) returns ESRCH on every
      // supported platform, so the lease is provably abandoned.
      const stale = await writeForeignLease(dir, { pid: 2_147_483_647 })

      const slot = await ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
        crossProcessTimeoutMs: 2_000,
      })
      const leases = await listLeases(dir)
      expect(leases).not.toContain(path.basename(stale))
      expect(leases).toHaveLength(1)
      expect(leases[0].startsWith(`${process.pid}-`)).toBe(true)
      slot[Symbol.dispose]()
    })

    test("a corrupted lease file never crashes acquisition (fail open), and is reclaimed once aged out", async () => {
      await using tmp = await tmpdir()
      const providerID = "gateway-corrupt"
      const dir = leaseDirFor(tmp.path, providerID)

      // Fresh corrupted file: ambiguous, counted conservatively as live, so
      // acquisition waits its bounded wait and then fails open — no crash.
      await fs.mkdir(dir, { recursive: true })
      const corrupted = path.join(dir, "corrupted.json")
      await fs.writeFile(corrupted, "definitely not json {{{")
      const slot = await ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
        crossProcessTimeoutMs: 250,
      })
      expect(slot).toBeDefined()
      slot[Symbol.dispose]()

      // Once its mtime outlives the TTL window it is provably abandoned and
      // gets pruned, freeing the slot for a real lease.
      const aged = Date.now() / 1000 - 200
      await fs.utimes(corrupted, aged, aged)
      const slot2 = await ProviderConcurrencyGovernor.acquire({
        providerID,
        limit: 1,
        stateRoot: tmp.path,
        crossProcessTimeoutMs: 2_000,
      })
      const leases = await listLeases(dir)
      expect(leases).toHaveLength(1)
      expect(leases).not.toContain(path.basename(corrupted))
      slot2[Symbol.dispose]()
    })

    test("never touches the lease directory with crossProcess: false", async () => {
      await using tmp = await tmpdir()
      const untouched = path.join(tmp.path, "never-created")
      const slot = await ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-local-only",
        limit: 1,
        stateRoot: untouched,
        crossProcess: false,
      })
      expect(slot).toBeDefined()
      await expect(fs.stat(path.join(untouched, "provider-slots"))).rejects.toThrow()
      slot[Symbol.dispose]()
    })
  })

  describe("fail open", () => {
    test("stateRoot pointing at a regular file resolves immediately instead of hanging or throwing", async () => {
      await using tmp = await tmpdir()
      const blocker = path.join(tmp.path, "blocker")
      await fs.writeFile(blocker, "a file where a directory is expected")

      const started = Date.now()
      // A long deadline proves the resolution comes from the I/O error path,
      // not from waiting the deadline out.
      const slot = await ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-failopen",
        limit: 1,
        stateRoot: blocker,
        crossProcessTimeoutMs: 60_000,
      })
      expect(Date.now() - started).toBeLessThan(5_000)
      expect(slot).toBeDefined()
      slot[Symbol.dispose]()
    })
  })

  describe("resetForTests", () => {
    test("clears all in-process queue state so a held slot no longer gates new acquires", async () => {
      const providerID = "gateway-reset"
      await ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false }) // never disposed
      let resolved = false
      const pending = ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false }).then(
        (slot) => {
          resolved = true
          return slot
        },
      )
      await tick()
      expect(resolved).toBe(false)

      ProviderConcurrencyGovernor.resetForTests()
      const fresh = await ProviderConcurrencyGovernor.acquire({ providerID, limit: 1, crossProcess: false })
      expect(fresh).toBeDefined()
      fresh[Symbol.dispose]()

      // The pre-reset queued acquire is still parked on its detached state
      // and must never settle spuriously; nothing to assert beyond it having
      // stayed pending above, so leave it unsettled and move on.
    })

    test("scoped reset only clears the named provider", async () => {
      await ProviderConcurrencyGovernor.acquire({ providerID: "gateway-reset-x", limit: 1, crossProcess: false })
      await ProviderConcurrencyGovernor.acquire({ providerID: "gateway-reset-y", limit: 1, crossProcess: false })

      ProviderConcurrencyGovernor.resetForTests("gateway-reset-y")
      const yFresh = await ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-reset-y",
        limit: 1,
        crossProcess: false,
      })
      expect(yFresh).toBeDefined()
      yFresh[Symbol.dispose]()

      let xResolved = false
      const xPending = ProviderConcurrencyGovernor.acquire({
        providerID: "gateway-reset-x",
        limit: 1,
        crossProcess: false,
      }).then((slot) => {
        xResolved = true
        return slot
      })
      await tick()
      expect(xResolved).toBe(false)
      ProviderConcurrencyGovernor.resetForTests("gateway-reset-x")
    })
  })
})
