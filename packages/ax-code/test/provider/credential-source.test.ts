// ADR-246: the `applyCredentialSource` helper translates a `credential_source`
// auth entry into the shape the underlying SDK / CLI expects. The test
// exercises the helper directly via `Provider.resolveCredentialSource` so we
// do not need to boot the full provider pipeline. Process env is restored
// after every test that mutates it.

import { test, expect, afterEach } from "vitest"
import { Provider } from "../../src/provider/provider"
import type { Auth } from "../../src/auth"

const ENV_KEYS = ["AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION"]
const originalEnv: Record<string, string | undefined> = {}

function captureEnv() {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
}
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
}

function authWith(entries: Array<[string, Auth.Info]>): Record<string, Auth.Info> {
  const out: Record<string, Auth.Info> = {}
  for (const [k, v] of entries) out[k] = v
  return out
}

afterEach(() => {
  restoreEnv()
})

test("aws_profile sets AWS_PROFILE / AWS_REGION / AWS_DEFAULT_REGION", async () => {
  captureEnv()
  const all = authWith([
    [
      "aws-bedrock",
      {
        type: "credential_source",
        source: { kind: "aws_profile", profile: "workstation", region: "us-east-1" },
      },
    ],
  ])
  const options: Record<string, unknown> = {}
  await Provider.resolveCredentialSource({ providerID: "aws-bedrock" }, options, {
    readAuth: async () => all,
  })
  expect(process.env["AWS_PROFILE"]).toBe("workstation")
  expect(process.env["AWS_REGION"]).toBe("us-east-1")
  expect(process.env["AWS_DEFAULT_REGION"]).toBe("us-east-1")
  expect(options).not.toHaveProperty("profile")
  expect(options).not.toHaveProperty("region")
})

test("gcloud_adc writes project + location to the options bag", async () => {
  const all = authWith([
    [
      "google-vertex-anthropic",
      {
        type: "credential_source",
        source: { kind: "gcloud_adc", project: "demo", location: "us-central1" },
      },
    ],
  ])
  const options: Record<string, unknown> = {}
  await Provider.resolveCredentialSource({ providerID: "google-vertex-anthropic" }, options, {
    readAuth: async () => all,
  })
  expect(options.project).toBe("demo")
  expect(options.location).toBe("us-central1")
  // We never read the secret. No env vars should be set.
  expect(process.env["GOOGLE_APPLICATION_CREDENTIALS"]).toBeUndefined()
})

test("azure_cli installs a placeholder key and a bearer-token fetch wrapper", async () => {
  captureEnv()
  const all = authWith([
    ["azure-openai", { type: "credential_source", source: { kind: "azure_cli", tenant: "t", subscription: "s" } }],
  ])
  const seen: Array<Headers> = []
  const options: Record<string, unknown> = {
    fetch: async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response("{}")
    },
  }
  await Provider.resolveCredentialSource({ providerID: "azure-openai" }, options, {
    readAuth: async () => all,
  })
  expect(options["apiKey"]).toBe("azure-cli-managed")
  expect(typeof options["fetch"]).toBe("function")
  // The wrapper is not invoked here: it would call the real `az`. Request-time behavior is covered in azure-token.test.ts.
  expect(seen).toEqual([])
  expect(process.env["AWS_PROFILE"]).toBeUndefined()
})

test("non-credential_source entries are ignored", async () => {
  captureEnv()
  const fakeKey = `sk-${Math.random().toString(36).slice(2, 10)}`
  const all = authWith([["anthropic", { type: "api", key: fakeKey }]])
  const options: Record<string, unknown> = {}
  await Provider.resolveCredentialSource({ providerID: "anthropic" }, options, {
    readAuth: async () => all,
  })
  expect(options).toEqual({})
  expect(process.env["AWS_PROFILE"]).toBeUndefined()
  expect(process.env["AWS_REGION"]).toBeUndefined()
})

test("unknown source kind is a no-op", async () => {
  captureEnv()
  // Force-pass the type union; the on-disk shape is structurally non-secret
  // so this is safe in test code.
  const all = authWith([["custom", { type: "credential_source", source: { kind: "made-up" } } as unknown as Auth.Info]])
  const options: Record<string, unknown> = {}
  await Provider.resolveCredentialSource({ providerID: "custom" }, options, {
    readAuth: async () => all,
  })
  expect(options).toEqual({})
})

test("auth read failure is swallowed and the helper no-ops", async () => {
  captureEnv()
  const options: Record<string, unknown> = {}
  await Provider.resolveCredentialSource({ providerID: "aws-bedrock" }, options, {
    readAuth: async () => {
      throw new Error("disk on fire")
    },
  })
  expect(options).toEqual({})
  expect(process.env["AWS_PROFILE"]).toBeUndefined()
})

test("missing entry for the provider is a no-op", async () => {
  captureEnv()
  const options: Record<string, unknown> = {}
  await Provider.resolveCredentialSource({ providerID: "no-such-provider" }, options, {
    readAuth: async () => ({}),
  })
  expect(options).toEqual({})
  expect(process.env["AWS_PROFILE"]).toBeUndefined()
})
