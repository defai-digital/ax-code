import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"
import { OsvCheck } from "../../src/mcp/osv-check"

interface RecordedCall {
  url: string
  body: string
}

function makeFetch(responses: Array<{ status?: number; body: string } | Error>): {
  fetch: typeof globalThis.fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  let i = 0
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const body = typeof init?.body === "string" ? init.body : ""
    calls.push({ url, body })
    const next = responses[i++] ?? responses[responses.length - 1]
    if (next instanceof Error) throw next
    return new Response(next.body, { status: next.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

let cachePath: string
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "osv-check-test-"))
  cachePath = path.join(dir, "mcp-osv-cache.json")
  OsvCheck._setOsvOverrides({ cachePath })
})

afterEach(async () => {
  OsvCheck._setOsvOverrides({})
  await fs.rm(dir, { recursive: true, force: true })
})

describe("parseLocalLaunch", () => {
  test("parses npx with a plain package", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "foo"])).toEqual({ ecosystem: "npm", name: "foo" })
  })

  test("parses npx with a pinned version", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "foo@1.2.3"])).toEqual({
      ecosystem: "npm",
      name: "foo",
      version: "1.2.3",
    })
  })

  test("does not treat a non-semver suffix as a version and stays linear", () => {
    const zeros = "0".repeat(80)
    const started = Date.now()
    expect(OsvCheck.parseLocalLaunch(["npx", `foo@${zeros}x`])).toEqual({ ecosystem: "npm", name: "foo" })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(OsvCheck.parseLocalLaunch(["npx", "foo@1.2.3-beta.1"])).toEqual({
      ecosystem: "npm",
      name: "foo",
      version: "1.2.3-beta.1",
    })
  })

  test("parses npx with --yes flag and a package", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "-y", "foo@latest"])).toEqual({
      ecosystem: "npm",
      name: "foo",
    })
  })

  test("parses npx -p <package> -- <command>", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "-p", "foo@1.0.0", "--", "bar", "--baz"])).toEqual({
      ecosystem: "npm",
      name: "foo",
      version: "1.0.0",
    })
  })

  test("parses npx with a scoped package", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "@scope/pkg"])).toEqual({
      ecosystem: "npm",
      name: "@scope/pkg",
    })
  })

  test("parses npx with a scoped package and version", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "@scope/pkg@2.0.0"])).toEqual({
      ecosystem: "npm",
      name: "@scope/pkg",
      version: "2.0.0",
    })
  })

  test("parses uvx", () => {
    expect(OsvCheck.parseLocalLaunch(["uvx", "ruff"])).toEqual({ ecosystem: "PyPI", name: "ruff" })
  })

  test("parses uvx with version", () => {
    expect(OsvCheck.parseLocalLaunch(["uvx", "ruff@0.6.0"])).toEqual({
      ecosystem: "PyPI",
      name: "ruff",
      version: "0.6.0",
    })
  })

  test("parses bunx", () => {
    expect(OsvCheck.parseLocalLaunch(["bunx", "vite"])).toEqual({ ecosystem: "npm", name: "vite" })
  })

  test("parses pnpm dlx", () => {
    expect(OsvCheck.parseLocalLaunch(["pnpm", "dlx", "create-app@1.0.0"])).toEqual({
      ecosystem: "npm",
      name: "create-app",
      version: "1.0.0",
    })
  })

  test("parses npm exec", () => {
    expect(OsvCheck.parseLocalLaunch(["npm", "exec", "vitest"])).toEqual({ ecosystem: "npm", name: "vitest" })
  })

  test("parses pipx run", () => {
    expect(OsvCheck.parseLocalLaunch(["pipx", "run", "black"])).toEqual({ ecosystem: "PyPI", name: "black" })
  })

  test("skips a local relative path", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "./local-server.js"])).toBeUndefined()
  })

  test("skips an absolute path", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "/usr/local/bin/foo"])).toBeUndefined()
  })

  test("skips a file: spec", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "file:./local-pkg"])).toBeUndefined()
  })

  test("skips a git+ spec", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "git+https://github.com/x/y.git"])).toBeUndefined()
  })

  test("skips a github: spec", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "github:user/repo"])).toBeUndefined()
  })

  test("skips an https URL", () => {
    expect(OsvCheck.parseLocalLaunch(["npx", "https://example.com/pkg.tgz"])).toBeUndefined()
  })

  test("returns undefined for unknown launchers", () => {
    expect(OsvCheck.parseLocalLaunch(["node", "server.js"])).toBeUndefined()
  })

  test("returns undefined for empty command", () => {
    expect(OsvCheck.parseLocalLaunch([])).toBeUndefined()
  })

  test("returns undefined when npx has no package", () => {
    expect(OsvCheck.parseLocalLaunch(["npx"])).toBeUndefined()
  })

  test("returns undefined when pnpm dlx has no package", () => {
    expect(OsvCheck.parseLocalLaunch(["pnpm", "dlx"])).toBeUndefined()
  })
})

describe("checkLocalLaunch", () => {
  test("throws McpOSVBlocked when a MAL- advisory is reported", async () => {
    const { fetch } = makeFetch([{ body: JSON.stringify({ vulns: [{ id: "MAL-2024-1234" }] }) }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await expect(OsvCheck.checkLocalLaunch(["npx", "evil-pkg"], "test")).rejects.toThrow(OsvCheck.McpOSVBlocked)
  })

  test("McpOSVBlocked carries the package and ids", async () => {
    const { fetch } = makeFetch([
      { body: JSON.stringify({ vulns: [{ id: "MAL-2024-9999" }, { id: "MAL-2024-0001" }] }) },
    ])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    try {
      await OsvCheck.checkLocalLaunch(["npx", "evil-pkg@1.2.3"], "test")
      throw new Error("expected to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(OsvCheck.McpOSVBlocked)
      if (error instanceof OsvCheck.McpOSVBlocked) {
        expect(error.data.package).toBe("evil-pkg")
        expect(error.data.version).toBe("1.2.3")
        expect(error.data.ids).toEqual(["MAL-2024-9999", "MAL-2024-0001"])
        expect(error.data.ecosystem).toBe("npm")
      }
    }
  })

  test("warns but does not throw on non-MAL advisories", async () => {
    const { fetch } = makeFetch([{ body: JSON.stringify({ vulns: [{ id: "GHSA-xxxx-yyyy-zzzz" }] }) }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(OsvCheck.checkLocalLaunch(["npx", "vuln-pkg"], "test")).resolves.toBeUndefined()
    warn.mockRestore()
  })

  test("fails open on a network error", async () => {
    const fetch = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof globalThis.fetch
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await expect(OsvCheck.checkLocalLaunch(["npx", "foo"], "test")).resolves.toBeUndefined()
  })

  test("fails open on a 5xx response", async () => {
    const { fetch } = makeFetch([{ status: 503, body: "Service Unavailable" }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await expect(OsvCheck.checkLocalLaunch(["npx", "foo"], "test")).resolves.toBeUndefined()
  })

  test("fails open on invalid JSON", async () => {
    const { fetch } = makeFetch([{ body: "not-json" }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await expect(OsvCheck.checkLocalLaunch(["npx", "foo"], "test")).resolves.toBeUndefined()
  })

  test("fails open on a response with the wrong shape", async () => {
    const { fetch } = makeFetch([{ body: JSON.stringify({ unexpected: true }) }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await expect(OsvCheck.checkLocalLaunch(["npx", "foo"], "test")).resolves.toBeUndefined()
  })

  test("fails open on a timeout", async () => {
    const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      // Honor the abort signal so the timeout path runs.
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          resolve()
          return
        }
        if (signal.aborted) {
          reject(new Error("aborted"))
          return
        }
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        // Never resolve on the happy path; the AbortController timer fires
        // and rejects above. The small setTimeout keeps the test honest if
        // the abort is ever lost.
        setTimeout(resolve, 100)
      })
      return new Response("{}", { status: 200 })
    }) as unknown as typeof globalThis.fetch
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await expect(OsvCheck.checkLocalLaunch(["npx", "foo"], "test")).resolves.toBeUndefined()
  })

  test("cache hit avoids the network on the second call", async () => {
    const { fetch, calls } = makeFetch([{ body: JSON.stringify({ vulns: [] }) }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await OsvCheck.checkLocalLaunch(["npx", "foo@1.0.0"], "test")
    await OsvCheck.checkLocalLaunch(["npx", "foo@1.0.0"], "test")
    // Repeated checks for the same package version reuse the cached result.
    expect(calls).toHaveLength(1)
  })

  test("cache miss on a different package triggers a second fetch", async () => {
    const { fetch, calls } = makeFetch([
      { body: JSON.stringify({ vulns: [] }) },
      { body: JSON.stringify({ vulns: [] }) },
    ])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await OsvCheck.checkLocalLaunch(["npx", "foo"], "test")
    await OsvCheck.checkLocalLaunch(["npx", "bar"], "test")
    expect(calls).toHaveLength(2)
  })

  test("persists the cache to disk for cross-process reuse", async () => {
    const { fetch } = makeFetch([{ body: JSON.stringify({ vulns: [] }) }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await OsvCheck.checkLocalLaunch(["npx", "foo"], "test")
    const onDisk = await fs.readFile(cachePath, "utf8")
    expect(onDisk).toContain('"foo"')
  })

  test("a non-launchable command does not call fetch", async () => {
    const { fetch, calls } = makeFetch([{ body: JSON.stringify({ vulns: [{ id: "MAL-0" }] }) }])
    OsvCheck._setOsvOverrides({ fetch, cachePath })
    await OsvCheck.checkLocalLaunch(["node", "server.js"], "test")
    expect(calls).toHaveLength(0)
  })
})

test("a version change rechecks advisories instead of reusing an older clean result", async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ vulns: [] }) },
    { body: JSON.stringify({ vulns: [{ id: "MAL-2026-1234" }] }) },
  ])
  OsvCheck._setOsvOverrides({ fetch, cachePath })
  await OsvCheck.checkLocalLaunch(["npx", "foo@1.0.0"], "test")
  await expect(OsvCheck.checkLocalLaunch(["npx", "foo@2.0.0"], "test")).rejects.toThrow(OsvCheck.McpOSVBlocked)
  expect(calls).toHaveLength(2)
})

test("cachedLookup waits for its best-effort persistence to finish", async () => {
  let release!: () => void
  let writing!: () => void
  const started = new Promise<void>((resolve) => {
    writing = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const write = vi.spyOn(Filesystem, "writeJson").mockImplementation(async () => {
    writing()
    await blocked
  })
  const { fetch } = makeFetch([{ body: JSON.stringify({ vulns: [] }) }])
  OsvCheck._setOsvOverrides({ fetch, cachePath })
  let settled = false
  const lookup = OsvCheck.cachedLookup({ ecosystem: "npm", name: "foo" }).finally(() => {
    settled = true
  })
  try {
    await started
    await Promise.resolve()
    expect(settled).toBe(false)
  } finally {
    release()
    await lookup
    write.mockRestore()
  }
})

test("concurrent lookups keep both entries in the persisted cache", async () => {
  let started = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fetch = (async () => {
    started++
    if (started === 2) release()
    await gate
    return new Response(JSON.stringify({ vulns: [] }), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  OsvCheck._setOsvOverrides({ fetch, cachePath })
  await Promise.all([
    OsvCheck.cachedLookup({ ecosystem: "npm", name: "alpha" }),
    OsvCheck.cachedLookup({ ecosystem: "npm", name: "beta" }),
  ])
  const onDisk = JSON.parse(await fs.readFile(cachePath, "utf8")) as { entries: Record<string, unknown> }
  expect(Object.keys(onDisk.entries).sort()).toEqual(["npm:alpha", "npm:beta"])
})

test("an aborted caller skips the network and does not cache an empty result", async () => {
  const { fetch, calls } = makeFetch([{ body: JSON.stringify({ vulns: [] }) }])
  OsvCheck._setOsvOverrides({ fetch, cachePath })
  const controller = new AbortController()
  controller.abort()
  await expect(OsvCheck.checkLocalLaunch(["npx", "foo"], "test", controller.signal)).resolves.toBeUndefined()
  expect(calls).toHaveLength(0)
  await OsvCheck.checkLocalLaunch(["npx", "foo"], "test")
  expect(calls).toHaveLength(1)
})
