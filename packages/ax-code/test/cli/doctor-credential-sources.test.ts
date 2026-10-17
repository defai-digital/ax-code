// ADR-246: doctor row `credential-sources` must run with injected fs and
// runner, never shell out, and never read secret material. The default
// production runners (aws / adc / az) are tested only at the unit level via
// the injectable surface here; the production shell-outs live in the
// implementation file and are out of scope for this test (they require a
// live CLI which is not available in the test environment).

import { test, expect } from "vitest"
import { getCredentialSourcesCheck } from "../../src/cli/cmd/doctor-credential-sources"
import type { Auth } from "../../src/auth"

function makeAuth(entries: Array<[string, Auth.Info]>): Record<string, Auth.Info> {
  const out: Record<string, Auth.Info> = {}
  for (const [k, v] of entries) out[k] = v
  return out
}

test("returns ok with no references", async () => {
  const check = await getCredentialSourcesCheck({
    readAuth: async () => ({}),
    readConfig: async () => undefined,
  })
  expect(check.name).toBe("Credential sources")
  expect(check.status).toBe("ok")
  expect(check.detail).toContain("no external credential references")
})

test("returns warn when an AWS profile probe fails", async () => {
  const check = await getCredentialSourcesCheck({
    readAuth: async () =>
      makeAuth([
        [
          "aws-bedrock",
          { type: "credential_source", source: { kind: "aws_profile", profile: "missing", region: "us-east-1" } },
        ],
      ]),
    awsProfileExists: async (profile: string) => ({
      ok: false,
      detail: `profile ${profile} not found in AWS config/credentials`,
    }),
    readConfig: async () => undefined,
  })
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("aws-bedrock")
  expect(check.detail).toContain("aws_profile missing")
  expect(check.detail).toContain("unresolvable")
  // We never echo a secret, so the profile name is fine; just confirm we did
  // not name any token-shaped string.
  expect(check.detail).not.toMatch(/sk-|AKIA|ghp_|eyJ[A-Za-z0-9_-]{8,}/)
})

test("returns ok when every probe succeeds", async () => {
  const check = await getCredentialSourcesCheck({
    readAuth: async () =>
      makeAuth([
        [
          "aws-bedrock",
          { type: "credential_source", source: { kind: "aws_profile", profile: "workstation", region: "us-east-1" } },
        ],
        [
          "google-vertex-anthropic",
          { type: "credential_source", source: { kind: "gcloud_adc", project: "demo", location: "us-central1" } },
        ],
      ]),
    awsProfileExists: async (profile: string) => ({ ok: true, detail: `profile ${profile} resolvable` }),
    adcPresent: async () => ({ ok: true, detail: "ADC file present" }),
    readConfig: async () => undefined,
  })
  expect(check.status).toBe("ok")
  expect(check.detail).toContain("2 references")
  expect(check.detail).toContain("2 resolvable")
})

test("ignores non-credential_source entries", async () => {
  const check = await getCredentialSourcesCheck({
    readAuth: async () =>
      makeAuth([["anthropic", { type: "api", key: `sk-${Math.random().toString(36).slice(2, 10)}` }]]),
    readConfig: async () => undefined,
  })
  expect(check.status).toBe("ok")
  expect(check.detail).toContain("no external credential references")
})

test("az probe failure is reported with a non-secret detail", async () => {
  const check = await getCredentialSourcesCheck({
    readAuth: async () =>
      makeAuth([
        ["azure-openai", { type: "credential_source", source: { kind: "azure_cli", tenant: "t", subscription: "s" } }],
      ]),
    azLoggedIn: async () => ({ ok: false, detail: "az account not logged in" }),
    readConfig: async () => undefined,
  })
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("azure-openai")
  expect(check.detail).toContain("az account not logged in")
  // We must not leak any az token shape into the detail string.
  expect(check.detail).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/)
})

test("unsupported source kind yields a warn entry", async () => {
  const check = await getCredentialSourcesCheck({
    readAuth: async () =>
      // Force-passing the union requires a cast; the on-disk shape is
      // structurally non-secret so this is safe in test code.
      makeAuth([["custom", { type: "credential_source", source: { kind: "made-up" } } as unknown as Auth.Info]]),
    readConfig: async () => undefined,
  })
  expect(check.status).toBe("warn")
  expect(check.detail).toContain("unsupported source kind made-up")
})
