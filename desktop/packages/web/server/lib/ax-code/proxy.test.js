import { describe, expect, it } from "vitest"
import express from "express"
import request from "supertest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  createCompatibilityRewriteCounter,
  createDirectoryQueryCanonicalizer,
  isDashboardProxyPathname,
  isAxCodeReadinessValueReady,
  registerAxCodeProxy,
} from "./proxy.js"

describe("isAxCodeReadinessValueReady", () => {
  it("accepts boolean and string ready values from ax-code health payloads", () => {
    expect(isAxCodeReadinessValueReady(true)).toBe(true)
    expect(isAxCodeReadinessValueReady("ready")).toBe(true)
    expect(isAxCodeReadinessValueReady(false)).toBe(false)
    expect(isAxCodeReadinessValueReady("starting")).toBe(false)
    expect(isAxCodeReadinessValueReady(undefined)).toBe(false)
  })
})

describe("createDirectoryQueryCanonicalizer", () => {
  it("canonicalizes directory query params and preserves other params", async () => {
    const canonicalize = createDirectoryQueryCanonicalizer({
      realpath: async (value) => (value === "/link/project" ? "/real/project" : value),
    })

    await expect(canonicalize("/session?foo=1&directory=/link/project&bar=2")).resolves.toBe(
      "/session?foo=1&directory=%2Freal%2Fproject&bar=2",
    )
  })

  it("caches directory realpath lookups", async () => {
    let calls = 0
    const canonicalize = createDirectoryQueryCanonicalizer({
      realpath: async () => {
        calls += 1
        return "/real/project"
      },
    })

    await expect(canonicalize("/session?directory=/link/project")).resolves.toBe("/session?directory=%2Freal%2Fproject")
    await expect(canonicalize("/session?directory=/link/project")).resolves.toBe("/session?directory=%2Freal%2Fproject")
    expect(calls).toBe(1)
  })

  it("deduplicates concurrent directory realpath lookups", async () => {
    let calls = 0
    let release = () => undefined
    const pending = new Promise((resolve) => {
      release = () => resolve("/real/project")
    })
    const canonicalize = createDirectoryQueryCanonicalizer({
      realpath: async () => {
        calls += 1
        return pending
      },
    })

    const first = canonicalize("/session?directory=/link/project")
    const second = canonicalize("/session?directory=/link/project")
    await Promise.resolve()

    expect(calls).toBe(1)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([
      "/session?directory=%2Freal%2Fproject",
      "/session?directory=%2Freal%2Fproject",
    ])
  })

  it("falls back to the original URL when realpath fails", async () => {
    const canonicalize = createDirectoryQueryCanonicalizer({
      realpath: async () => {
        throw new Error("missing")
      },
    })

    await expect(canonicalize("/session?foo=1&directory=/missing/project")).resolves.toBe(
      "/session?foo=1&directory=/missing/project",
    )
  })

  it("leaves URLs without directory params unchanged", async () => {
    const canonicalize = createDirectoryQueryCanonicalizer({
      realpath: async () => "/real/project",
    })

    await expect(canonicalize("/session?foo=1")).resolves.toBe("/session?foo=1")
  })
})

describe("createCompatibilityRewriteCounter", () => {
  it("starts at zero", () => {
    const counter = createCompatibilityRewriteCounter()
    expect(counter.snapshot()).toEqual({ provider: 0, configProviders: 0, total: 0 })
  })

  it("increments provider and configProviders counts independently", () => {
    const counter = createCompatibilityRewriteCounter()
    counter.increment("provider")
    counter.increment("provider")
    counter.increment("configProviders")
    expect(counter.snapshot()).toEqual({ provider: 2, configProviders: 1, total: 3 })
  })

  it("ignores unknown counter kinds", () => {
    const counter = createCompatibilityRewriteCounter()
    counter.increment("unknown")
    expect(counter.snapshot()).toEqual({ provider: 0, configProviders: 0, total: 0 })
  })

  it("resets all counts to zero", () => {
    const counter = createCompatibilityRewriteCounter()
    counter.increment("provider")
    counter.increment("configProviders")
    counter.reset()
    expect(counter.snapshot()).toEqual({ provider: 0, configProviders: 0, total: 0 })
  })
})

describe("isDashboardProxyPathname", () => {
  it("matches DRE graph dashboard paths without matching unrelated paths", () => {
    expect(isDashboardProxyPathname("/dre-graph")).toBe(true)
    expect(isDashboardProxyPathname("/dre-graph/session/session-1")).toBe(true)
    expect(isDashboardProxyPathname("/graph/session-1")).toBe(true)
    expect(isDashboardProxyPathname("/api/dre-graph")).toBe(false)
    expect(isDashboardProxyPathname("/dre-graphical")).toBe(false)
  })
})

describe("ax-code readiness gate", () => {
  const createGatedApp = (runtimeState) => {
    const app = express()
    registerAxCodeProxy(app, {
      fs,
      os,
      path,
      OPEN_CODE_READY_GRACE_MS: 60_000,
      getRuntime: () => runtimeState,
      getAxCodeAuthHeaders: () => ({}),
      buildAxCodeUrl: (route) => `http://127.0.0.1:4096${route}`,
      ensureAxCodeApiPrefix: () => {},
    })
    return app
  }

  const createNotReadyState = (overrides = {}) => ({
    axCodePort: null,
    axCodeBaseUrl: null,
    isAxCodeReady: false,
    isRestartingAxCode: false,
    axCodeNotReadySince: Date.now(),
    lastAxCodeError: null,
    axCodeNextRetryAt: 0,
    axCodeRetryExhausted: false,
    ...overrides,
  })

  it("keeps the legacy restarting payload while the backend is starting", async () => {
    const response = await request(createGatedApp(createNotReadyState())).get("/api/session").expect(503)

    expect(response.body).toEqual({ error: "ax-code is restarting", restarting: true })
  })

  it("surfaces the last error and next retry time while a retry is scheduled", async () => {
    const nextRetryAt = Date.now() + 5000
    const response = await request(
      createGatedApp(createNotReadyState({ lastAxCodeError: "spawn failed", axCodeNextRetryAt: nextRetryAt })),
    )
      .get("/api/session")
      .expect(503)

    expect(response.body).toEqual({
      error: "ax-code is restarting",
      restarting: true,
      lastError: "spawn failed",
      nextRetryAt,
    })
  })

  it("flips restarting to false once the retry budget is exhausted", async () => {
    const response = await request(
      createGatedApp(createNotReadyState({ lastAxCodeError: "spawn failed", axCodeRetryExhausted: true })),
    )
      .get("/api/session")
      .expect(503)

    expect(response.body).toEqual({
      error: "ax-code failed to start",
      restarting: false,
      lastError: "spawn failed",
    })
  })
})
