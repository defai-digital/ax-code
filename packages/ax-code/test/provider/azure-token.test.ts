import { expect, test } from "vitest"
import { AzureToken } from "../../src/provider/azure-token"

const reply = (token: string, expiresOn: number) => ({
  code: 0,
  stdout: JSON.stringify({ accessToken: token, expires_on: Math.floor(expiresOn / 1000) }),
})

test("command passes tenant and subscription as separate arguments and refuses option-like values", () => {
  expect(AzureToken.command({ tenant: "t-1", subscription: "s.2" })).toEqual([
    "az",
    "account",
    "get-access-token",
    "--resource",
    AzureToken.RESOURCE,
    "--output",
    "json",
    "--tenant",
    "t-1",
    "--subscription",
    "s.2",
  ])
  expect(AzureToken.command({ tenant: "--debug" })).toBeUndefined()
  expect(AzureToken.command({ subscription: "a b" })).toBeUndefined()
  expect(AzureToken.command({ subscription: "x;y" })).toBeUndefined()
})

test("tokens are cached until five minutes before expiry and refreshed afterwards", async () => {
  let now = 1_000_000
  let calls = 0
  const source = AzureToken.create(
    {},
    {
      now: () => now,
      exec: async () => reply(`token-${++calls}`, now + 3_600_000),
    },
  )
  expect(await source.get()).toBe("token-1")
  now += 3_000_000
  expect(await source.get()).toBe("token-1")
  now += 400_000
  expect(await source.get()).toBe("token-2")
  expect(calls).toBe(2)
})

test("concurrent callers share one az invocation", async () => {
  let calls = 0
  const source = AzureToken.create(
    {},
    {
      now: () => 0,
      exec: async () => {
        calls++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return reply("shared", 3_600_000)
      },
    },
  )
  expect(await Promise.all([source.get(), source.get(), source.get()])).toEqual(["shared", "shared", "shared"])
  expect(calls).toBe(1)
})

test("failures are generic, never echo az output, and are not cached", async () => {
  let ok = false
  const source = AzureToken.create(
    {},
    {
      now: () => 0,
      exec: async () => (ok ? reply("late", 3_600_000) : { code: 1, stdout: "secret-looking stdout" }),
    },
  )
  const error = await source.get().catch((e: Error) => e)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain("az login")
  expect((error as Error).message).not.toContain("secret-looking")
  ok = true
  expect(await source.get()).toBe("late")
  const missing = AzureToken.create(
    {},
    {
      exec: async () => {
        throw new Error("spawn az ENOENT")
      },
    },
  )
  await expect(missing.get()).rejects.toThrow("Azure CLI is unavailable")
  await expect(AzureToken.create({ tenant: "--bad" }).get()).rejects.toThrow("invalid tenant or subscription")
})

test("malformed az output is refused", async () => {
  for (const stdout of ["not json", "[]", "{}", JSON.stringify({ accessToken: "" })]) {
    const source = AzureToken.create({}, { exec: async () => ({ code: 0, stdout }) })
    await expect(source.get()).rejects.toThrow("could not provide an access token")
  }
})

test("wrapFetch replaces the placeholder api-key with a bearer token and keeps other headers", async () => {
  let seen: Headers | undefined
  const base = (async (_input: unknown, init?: RequestInit) => {
    seen = new Headers(init?.headers)
    return new Response("{}")
  }) as typeof fetch
  const wrapped = AzureToken.wrapFetch(base, { get: async () => "bearer-value" })
  await wrapped("https://example.invalid/openai", {
    method: "POST",
    headers: { "api-key": AzureToken.PLACEHOLDER_KEY, "content-type": "application/json" },
    body: "{}",
  })
  expect(seen?.get("authorization")).toBe("Bearer bearer-value")
  expect(seen?.has("api-key")).toBe(false)
  expect(seen?.get("content-type")).toBe("application/json")
})

test("a token failure fails the request without calling the network", async () => {
  let called = false
  const base = (async () => {
    called = true
    return new Response("{}")
  }) as unknown as typeof fetch
  const wrapped = AzureToken.wrapFetch(base, {
    get: async () => {
      throw new Error("Azure CLI could not provide an access token; run `az login`")
    },
  })
  await expect(wrapped("https://example.invalid/", {})).rejects.toThrow("az login")
  expect(called).toBe(false)
})

test("a response without an expiry stays cached past the refresh margin", async () => {
  let now = 0
  let calls = 0
  const source = AzureToken.create(
    {},
    {
      now: () => now,
      exec: async () => {
        calls++
        return { code: 0, stdout: JSON.stringify({ accessToken: "fallback" }) }
      },
    },
  )
  expect(await source.get()).toBe("fallback")
  now += 60_000
  expect(await source.get()).toBe("fallback")
  expect(calls).toBe(1)
})

test("accepts a string epoch in expires_on", async () => {
  let now = 0
  let calls = 0
  const source = AzureToken.create(
    {},
    {
      now: () => now,
      exec: async () => {
        calls++
        return { code: 0, stdout: JSON.stringify({ accessToken: "string-epoch", expires_on: "7200" }) }
      },
    },
  )
  expect(await source.get()).toBe("string-epoch")
  now = 3_600_000
  expect(await source.get()).toBe("string-epoch")
  expect(calls).toBe(1)
})

test("one caller's abort does not fail another caller sharing the lookup", async () => {
  const controller = new AbortController()
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  const source = AzureToken.create(
    {},
    {
      now: () => 0,
      exec: async () => {
        await gate
        return reply("shared", 3_600_000)
      },
    },
  )
  const aborted = source.get(controller.signal)
  const abortedResult = aborted.then(
    () => undefined,
    (error: Error) => error,
  )
  const surviving = source.get()
  controller.abort()
  release?.()
  expect((await abortedResult)?.message).toMatch(/abort/i)
  await expect(surviving).resolves.toBe("shared")
})

test("an already-aborted caller does not start an az lookup", async () => {
  let calls = 0
  const source = AzureToken.create(
    {},
    {
      exec: async () => {
        calls++
        return reply("unused", 3_600_000)
      },
    },
  )
  const controller = new AbortController()
  controller.abort()
  await expect(source.get(controller.signal)).rejects.toThrow()
  expect(calls).toBe(0)
})

test("wrapFetch forwards a Request signal to the token source", async () => {
  const controller = new AbortController()
  let received: AbortSignal | undefined
  const wrapped = AzureToken.wrapFetch(async () => new Response("{}"), {
    get: async (signal) => {
      received = signal
      return "token"
    },
  })
  await wrapped(new Request("https://example.invalid/", { signal: controller.signal }))
  expect(received?.aborted).toBe(false)
  controller.abort()
  expect(received?.aborted).toBe(true)
})

test("cached tokens still honor an already-aborted caller", async () => {
  const source = AzureToken.create({}, { now: () => 0, exec: async () => reply("cached", 3_600_000) })
  await source.get()
  const reason = new Error("cancel cached request")
  const controller = new AbortController()
  controller.abort(reason)
  await expect(source.get(controller.signal)).rejects.toBe(reason)
})

test("cancellation during shared lookup startup is not missed", async () => {
  const controller = new AbortController()
  const reason = new Error("cancel during startup")
  const source = AzureToken.create(
    {},
    {
      now: () => 0,
      exec: async () => {
        controller.abort(reason)
        return reply("shared", 3_600_000)
      },
    },
  )
  await expect(source.get(controller.signal)).rejects.toBe(reason)
  await expect(source.get()).resolves.toBe("shared")
})

test("wrapFetch respects explicit null signal overriding an aborted Request", async () => {
  const controller = new AbortController()
  controller.abort(new Error("original request canceled"))
  const input = new Request("https://example.invalid/", { signal: controller.signal })
  expect(new Request(input, { signal: null }).signal.aborted).toBe(false)
  const source = AzureToken.create({}, { now: () => 0, exec: async () => reply("unused", 3_600_000) })
  const wrapped = AzureToken.wrapFetch(async () => new Response("ok"), source)
  await expect(wrapped(input, { signal: null })).resolves.toBeInstanceOf(Response)
})

test("wrapFetch uses init headers to replace Request headers as native fetch does", async () => {
  const input = new Request("https://example.invalid/", {
    headers: { "x-original": "old", "content-type": "text/plain" },
  })
  const init = { headers: { "x-current": "new" } }
  let seen: Headers | undefined
  const wrapped = AzureToken.wrapFetch(
    async (_input, request) => {
      seen = new Headers(request?.headers)
      return new Response("ok")
    },
    { get: async () => "token" },
  )
  await wrapped(input, init)
  const expected = new Headers(new Request(input, init).headers)
  expected.set("authorization", "Bearer token")
  expect([...seen!]).toEqual([...expected])
})

test("wrapFetch does not invoke the transport when canceled during token lookup", async () => {
  const controller = new AbortController()
  const reason = new Error("cancel token wait")
  let called = false
  const wrapped = AzureToken.wrapFetch(
    async () => {
      called = true
      return new Response("ok")
    },
    {
      get: async () => {
        controller.abort(reason)
        return "token"
      },
    },
  )
  await expect(wrapped("https://example.invalid/", { signal: controller.signal })).rejects.toBe(reason)
  expect(called).toBe(false)
})

test("cancellation preserves a non-Error abort reason", async () => {
  const controller = new AbortController()
  const reason = { code: "caller-canceled" }
  controller.abort(reason)
  const source = AzureToken.create({}, { exec: async () => reply("unused", 3_600_000) })
  await expect(source.get(controller.signal)).rejects.toBe(reason)
})

test("wrapFetch snapshots request options before awaiting a token", async () => {
  let resolveToken!: (token: string) => void
  const token = new Promise<string>((resolve) => {
    resolveToken = resolve
  })
  const headers = new Headers({ "x-original": "before" })
  const init: RequestInit = { method: "POST", headers, body: "payload" }
  const expected = new Request("https://example.invalid/", init)
  let received: Request | undefined
  const wrapped = AzureToken.wrapFetch(
    async (input, options) => {
      received = new Request(input, options)
      return new Response("ok")
    },
    { get: () => token },
  )
  const pending = wrapped("https://example.invalid/", init)
  headers.set("x-original", "after")
  init.method = "PUT"
  resolveToken("token")
  await pending
  expect(received!.method).toBe(expected.method)
  expect(received!.headers.get("x-original")).toBe(expected.headers.get("x-original"))
})

test("wrapFetch snapshots inherited Request headers before awaiting a token", async () => {
  let resolveToken!: (token: string) => void
  const token = new Promise<string>((resolve) => {
    resolveToken = resolve
  })
  const input = new Request("https://example.invalid/", { headers: { "x-original": "before" } })
  let received: Headers | undefined
  const wrapped = AzureToken.wrapFetch(
    async (_input, init) => {
      received = new Headers(init?.headers)
      return new Response("ok")
    },
    { get: () => token },
  )
  const pending = wrapped(input)
  input.headers.set("x-original", "after")
  resolveToken("token")
  await pending
  expect(received!.get("x-original")).toBe("before")
})
