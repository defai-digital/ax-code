import { describe, expect, test } from "vitest"
import { MAX_REDIRECT_HOPS, redirectOriginOutsideAllowlist, type ProbeFetch } from "../../src/mcp/webmcp-redirect"

type Reply = { status: number; location?: string | null }

function fakeFetch(replies: Record<string, Reply>, calls: string[] = []): ProbeFetch {
  return async (url) => {
    calls.push(url)
    const reply = replies[url] ?? { status: 200 }
    return {
      status: reply.status,
      headers: { get: (name: string) => (name.toLowerCase() === "location" ? (reply.location ?? null) : null) },
    }
  }
}

const allowed = ["https://a.test"]

describe("WebMCP redirect probe (ADR-168)", () => {
  test("returns the first redirect origin outside the allowlist", async () => {
    const fetchImpl = fakeFetch({ "https://a.test/start": { status: 301, location: "https://b.test/x" } })
    expect(await redirectOriginOutsideAllowlist("https://a.test/start", allowed, fetchImpl)).toBe("https://b.test")
  })

  test("follows an allowed hop and reports the next disallowed origin", async () => {
    const calls: string[] = []
    const fetchImpl = fakeFetch(
      {
        "https://a.test/1": { status: 302, location: "https://a.test/2" },
        "https://a.test/2": { status: 301, location: "https://c.test/" },
      },
      calls,
    )
    expect(await redirectOriginOutsideAllowlist("https://a.test/1", allowed, fetchImpl)).toBe("https://c.test")
    expect(calls).toEqual(["https://a.test/1", "https://a.test/2"])
  })

  test("never requests the disallowed target origin", async () => {
    const calls: string[] = []
    const fetchImpl = fakeFetch({ "https://a.test/start": { status: 301, location: "https://evil.test/" } }, calls)
    await redirectOriginOutsideAllowlist("https://a.test/start", allowed, fetchImpl)
    expect(calls).toEqual(["https://a.test/start"])
  })

  test("fails closed on a non-grantable or unallowed start URL, and on an aborted signal", async () => {
    const fetchImpl = fakeFetch({})
    expect(await redirectOriginOutsideAllowlist("http://a.test/", allowed, fetchImpl)).toBeUndefined()
    expect(await redirectOriginOutsideAllowlist("https://other.test/", allowed, fetchImpl)).toBeUndefined()
    expect(await redirectOriginOutsideAllowlist("blob:https://a.test/x", allowed, fetchImpl)).toBeUndefined()
    expect(await redirectOriginOutsideAllowlist("https://user:pw@a.test/", allowed, fetchImpl)).toBeUndefined()
    const controller = new AbortController()
    controller.abort()
    expect(
      await redirectOriginOutsideAllowlist("https://a.test/x", allowed, fakeFetch({}), { signal: controller.signal }),
    ).toBeUndefined()
  })

  test("fails closed on non-3xx, missing Location and non-grantable Location", async () => {
    expect(
      await redirectOriginOutsideAllowlist(
        "https://a.test/x",
        allowed,
        fakeFetch({ "https://a.test/x": { status: 200 } }),
      ),
    ).toBeUndefined()
    expect(
      await redirectOriginOutsideAllowlist(
        "https://a.test/x",
        allowed,
        fakeFetch({ "https://a.test/x": { status: 301, location: null } }),
      ),
    ).toBeUndefined()
    expect(
      await redirectOriginOutsideAllowlist(
        "https://a.test/x",
        allowed,
        fakeFetch({ "https://a.test/x": { status: 301, location: "javascript:alert(1)" } }),
      ),
    ).toBeUndefined()
    // A cross-origin downgrade to a non-loopback http origin is not grantable.
    expect(
      await redirectOriginOutsideAllowlist(
        "https://a.test/x",
        allowed,
        fakeFetch({ "https://a.test/x": { status: 301, location: "http://evil.test/" } }),
      ),
    ).toBeUndefined()
  })

  test("fails closed when a hop throws or the hop cap is reached", async () => {
    const throwing: ProbeFetch = async () => {
      throw new Error("boom")
    }
    expect(await redirectOriginOutsideAllowlist("https://a.test/x", allowed, throwing)).toBeUndefined()
    const chain: Record<string, Reply> = {}
    for (let i = 0; i <= MAX_REDIRECT_HOPS + 1; i++)
      chain[`https://a.test/${i}`] = { status: 301, location: `https://a.test/${i + 1}` }
    expect(await redirectOriginOutsideAllowlist("https://a.test/0", allowed, fakeFetch(chain))).toBeUndefined()
  })
})
