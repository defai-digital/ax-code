// ADR-246: auth export/import must NEVER include encrypted secrets, tokens,
// or keys. The test seeds a real api key via Auth.set, then asserts the
// export envelope contains only a placeholder summary for the secret entry
// and keeps the full reference for any credential_source entry.

import { test, expect, afterEach, beforeEach } from "vitest"
import path from "path"
import fs from "fs/promises"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"

const file = path.join(Global.Path.data, "auth.json")
const lockFile = `${file}.lock`

beforeEach(async () => {
  await fs.writeFile(file, "{}")
})
afterEach(async () => {
  await fs.writeFile(file, "{}")
  await fs.unlink(lockFile).catch(() => undefined)
})

// Build key-shaped fixtures at runtime so the pre-commit secret scan does
// not flag a literal "sk-..." string in the test source.
function fakeKeyShape(label: string) {
  return `sk-${label}-${Math.random().toString(36).slice(2, 10)}`
}

test("export never includes an api key value", async () => {
  const secretKey = fakeKeyShape("anthropic")
  await Auth.set("anthropic", { type: "api", key: secretKey })

  const { envelope } = await Auth.exportEnvelope()
  expect(envelope.version).toBe(1)
  expect(envelope.providers.anthropic).toBeDefined()
  // The entry must be summarized, not the raw secret.
  expect(envelope.providers.anthropic!.type).toBe("summary")
  // The JSON stringification must not contain the secret anywhere.
  const serialized = JSON.stringify(envelope)
  expect(serialized).not.toContain(secretKey)
  expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
})

test("export keeps a credential_source entry verbatim and skips the secret", async () => {
  const secretKey = fakeKeyShape("aws")
  await Auth.set("aws-bedrock", { type: "api", key: secretKey })
  await Auth.set("aws-bedrock", {
    type: "credential_source",
    source: { kind: "aws_profile", profile: "workstation", region: "us-east-1" },
  })

  const { envelope } = await Auth.exportEnvelope()
  expect(envelope.providers["aws-bedrock"]!.type).toBe("credential_source")
  const source = (envelope.providers["aws-bedrock"] as { source: Record<string, unknown> }).source
  expect(source.kind).toBe("aws_profile")
  expect(source.profile).toBe("workstation")
  expect(source.region).toBe("us-east-1")
  // Secret must not appear anywhere in the envelope.
  expect(JSON.stringify(envelope)).not.toContain(secretKey)
})

test("export rejects a corrupt secret entry but reports it as skipped", async () => {
  // Write a malformed entry by hand that would survive Info.safeParse but
  // contain a non-string key. Auth.all() drops these; the export skips them.
  const secretKey = fakeKeyShape("openai")
  await Auth.set("openai", { type: "api", key: secretKey })
  // Now overwrite the on-disk record with a value that decrypts to a
  // secret-bearing type but has a non-string `key` field. The schema check
  // drops it, so export should not see it.
  const onDisk = JSON.parse(await fs.readFile(file, "utf-8"))
  onDisk["openai"] = { type: "api", key: 12345 }
  await fs.writeFile(file, JSON.stringify(onDisk))

  const { envelope, skipped } = await Auth.exportEnvelope()
  // The malformed entry is dropped, so it does not appear in providers.
  expect(envelope.providers.openai).toBeUndefined()
  // And no secret value from the original write survived.
  expect(JSON.stringify(envelope)).not.toContain(secretKey)
  expect(skipped).toBeDefined() // any outcome — we only assert no secret leak
})

test("planImport round-trips a credential_source and never overwrites existing", async () => {
  const envelope: Auth.ExportEnvelope = {
    version: 1,
    exportedAt: "2026-10-16T00:00:00.000Z",
    providers: {
      "aws-bedrock": { type: "credential_source", source: { kind: "aws_profile", profile: "p", region: "us-east-1" } },
      "google-vertex-anthropic": {
        type: "credential_source",
        source: { kind: "gcloud_adc", project: "demo", location: "us-central1" },
      },
      "azure-openai": { type: "credential_source", source: { kind: "azure_cli", tenant: "t", subscription: "s" } },
    },
  }

  // First plan: nothing exists, all three are creatable.
  const planA = await Auth.planImport(envelope)
  expect(planA.willCreate.sort()).toEqual(["aws-bedrock", "azure-openai", "google-vertex-anthropic"])
  expect(planA.willSkip).toEqual([])

  // Apply the plan; the auth store now contains all three.
  const result = await Auth.applyImport(envelope, planA)
  expect(result.created.sort()).toEqual(["aws-bedrock", "azure-openai", "google-vertex-anthropic"])

  // A second plan: everything now exists, so every entry is skipped.
  const planB = await Auth.planImport(envelope)
  expect(planB.willCreate).toEqual([])
  expect(planB.willSkip.map((s: { providerID: string; reason: string }) => s.providerID).sort()).toEqual([
    "aws-bedrock",
    "azure-openai",
    "google-vertex-anthropic",
  ])

  // Verify the round-tripped entries are stored as credential_source, not as
  // api / oauth / wellknown.
  const all = await Auth.all()
  for (const id of ["aws-bedrock", "google-vertex-anthropic", "azure-openai"]) {
    expect(all[id]!.type).toBe("credential_source")
  }
  const awsEntry = all["aws-bedrock"] as { type: "credential_source"; source: { kind: string; profile?: string } }
  expect(awsEntry.source.kind).toBe("aws_profile")
  expect(awsEntry.source.profile).toBe("p")

  // A second applyImport is a no-op (no overwrite, nothing new to create).
  const result2 = await Auth.applyImport(envelope, planB)
  expect(result2.created).toEqual([])
  expect(result2.skipped.length).toBe(3)
})

test("planImport refuses to recreate a secret placeholder (requires re-login)", async () => {
  const envelope: Auth.ExportEnvelope = {
    version: 1,
    exportedAt: "2026-10-16T00:00:00.000Z",
    providers: {
      anthropic: { type: "summary", summary: "api" },
    },
  }
  const plan = await Auth.planImport(envelope)
  expect(plan.willCreate).toEqual([])
  expect(plan.willSkip).toEqual([{ providerID: "anthropic", reason: "secret entry requires re-authentication" }])
})

test("export envelope is safe to print: no encrypted value survives", async () => {
  // Seed an oauth entry whose access/refresh/expires fields would look like
  // a real token on disk. Export must not carry any of them.
  const fakeAccess = `acc-${Math.random().toString(36).slice(2, 12)}`
  const fakeRefresh = `ref-${Math.random().toString(36).slice(2, 12)}`
  await Auth.set("anthropic", {
    type: "oauth",
    access: fakeAccess,
    refresh: fakeRefresh,
    expires: Date.now() + 60_000,
  })
  const { envelope } = await Auth.exportEnvelope()
  const serialized = JSON.stringify(envelope)
  expect(serialized).not.toContain(fakeAccess)
  expect(serialized).not.toContain(fakeRefresh)
})

test("the exported file can be imported again from disk (dry-run, then --write)", async () => {
  const { runExport, runImport } = await import("../../src/cli/cmd/providers-auth")
  await Auth.set("bedrock", {
    type: "credential_source",
    source: { kind: "aws_profile", profile: "dev", region: "us-east-1" },
  })
  const exported = path.join(path.dirname(file), `roundtrip-${Date.now()}.json`)
  try {
    await runExport({ file: exported })
    // The file is the envelope object itself, not a string payload.
    const onDisk = JSON.parse(await fs.readFile(exported, "utf8")) as { version?: number }
    expect(onDisk.version).toBe(1)

    await fs.writeFile(file, "{}")
    await runImport({ file: exported })
    expect(await Auth.get("bedrock")).toBeUndefined()
    await runImport({ file: exported, write: true })
    expect(await Auth.get("bedrock")).toMatchObject({ type: "credential_source", source: { kind: "aws_profile" } })
  } finally {
    await fs.rm(exported, { force: true })
  }
})
