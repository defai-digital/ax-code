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
