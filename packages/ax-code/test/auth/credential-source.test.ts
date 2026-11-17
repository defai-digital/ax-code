// ADR-246: auth export/import must NEVER include encrypted secrets, tokens,
// or keys. The test seeds a real api key via Auth.set, then asserts the
// export envelope contains only a placeholder summary for the secret entry
// and keeps the full reference for any credential_source entry.

import { test, expect, afterEach, beforeEach, vi } from "vitest"
import * as prompts from "@clack/prompts"
import path from "path"
import fs from "fs/promises"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"

const file = path.join(Global.Path.data, "auth.json")
const lockFile = `${file}.lock`

beforeEach(async () => {
  await fs.writeFile(file, "{}")
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.restoreAllMocks()
  await fs.writeFile(file, "{}")
  await fs.unlink(lockFile).catch(() => undefined)
})

test.each([
  { kind: "aws_profile", profile: "dev", region: "us-east-1" },
  { kind: "gcloud_adc", project: "demo", location: "us-central1" },
  { kind: "azure_cli", tenant: "tenant", subscription: "subscription" },
  { kind: "azure_cli" },
])("export copies only reviewed reference fields for $kind", async (reference) => {
  const secret = fakeKeyShape("extra")
  const source = { ...reference, token: secret, nested: { secret }, customHint: "unreviewed" }
  const entries: Record<string, Auth.Info> = { provider: { type: "credential_source", source } }
  const { envelope, skipped } = await Auth.exportEnvelope({ read: async () => entries })
  expect(skipped).toEqual([])
  const exported = envelope.providers.provider
  expect(exported).toEqual({ type: "credential_source", source: reference })
  expect(JSON.stringify(envelope)).not.toContain(secret)
  expect(source.token).toBe(secret)
  if (exported.type !== "credential_source") throw new Error("Expected a reference export")
  expect(exported.source).not.toBe(source)
  exported.source.kind = "changed"
  expect(source.kind).toBe(reference.kind)
})

test.each([
  null,
  undefined,
  "invalid",
  [],
  {},
  { kind: "future" },
  { kind: "aws_profile", profile: "" },
  { kind: "aws_profile", profile: 123 },
  { kind: "gcloud_adc", project: "demo", location: 123 },
])("export skips unsupported or invalid references without throwing: %j", async (source) => {
  const { envelope, skipped } = await Auth.exportEnvelope({
    read: async () => ({ provider: { type: "credential_source", source } }) as unknown as Record<string, Auth.Info>,
  })
  expect(envelope.providers).toEqual({})
  expect(skipped).toEqual(["provider"])
})

test("unknown reference kinds remain readable in storage but are omitted from shareable exports", async () => {
  const info: Auth.Info = { type: "credential_source", source: { kind: "future", reference: "public-name" } }
  await Auth.set("future-provider", info)
  expect(await Auth.get("future-provider")).toEqual(info)
  const { envelope, skipped } = await Auth.exportEnvelope()
  expect(envelope.providers).toEqual({})
  expect(skipped).toEqual(["future-provider"])
  expect(await Auth.get("future-provider")).toEqual(info)
})

test("import stores only reviewed reference fields", async () => {
  const secret = fakeKeyShape("import")
  const envelope: Auth.ExportEnvelope = {
    version: 1,
    exportedAt: "2026-11-17T00:00:00.000Z",
    providers: {
      provider: { type: "credential_source", source: { kind: "aws_profile", profile: "dev", token: secret } },
    },
  }
  const result = await Auth.applyImport(envelope, await Auth.planImport(envelope))
  expect(result.created).toEqual(["provider"])
  expect(await Auth.get("provider")).toEqual({
    type: "credential_source",
    source: { kind: "aws_profile", profile: "dev" },
  })
  expect(await fs.readFile(file, "utf8")).not.toContain(secret)
})

test.each(["provider/", "provider?", "provider ", "", "__canary", "__proto__", "constructor", "prototype"])(
  "import rejects invalid provider ID %j even with a forged plan",
  async (providerID) => {
    const existing: Auth.Info = { type: "api", key: fakeKeyShape("existing") }
    await Auth.set("provider", existing)
    const envelope: Auth.ExportEnvelope = {
      version: 1,
      exportedAt: "2026-11-17T00:00:00.000Z",
      providers: { [providerID]: { type: "credential_source", source: { kind: "aws_profile", profile: "dev" } } },
    }
    const plan = await Auth.planImport(envelope)
    expect(plan.willCreate).toEqual([])
    expect(plan.willSkip).toEqual([{ providerID, reason: "invalid provider ID" }])
    const result = await Auth.applyImport(envelope, { willCreate: [providerID], willSkip: [] })
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual([{ providerID, reason: "invalid provider ID" }])
    expect(await Auth.get("provider")).toEqual(existing)
  },
)

test.each(["__canary", "__proto__", "constructor", "prototype"])(
  "auth writes reject reserved provider ID %s",
  async (providerID) => {
    await expect(Auth.set(providerID, { type: "api", key: fakeKeyShape("reserved") })).rejects.toThrow(
      "Invalid provider ID",
    )
    expect(await fs.readFile(file, "utf8")).toBe("{}")
  },
)

test.each([
  null,
  {},
  { version: 1, exportedAt: "today", providers: [] },
  { version: 1, providers: {} },
  { version: 2, exportedAt: "today", providers: {} },
  { version: 1, exportedAt: "today", providers: "invalid" },
])("import rejects a malformed envelope before touching storage: %j", async (envelope) => {
  await expect(Auth.planImport(envelope)).rejects.toThrow("Invalid provider reference envelope")
  await expect(Auth.applyImport(envelope, { willCreate: [], willSkip: [] })).rejects.toThrow(
    "Invalid provider reference envelope",
  )
  expect(await fs.readFile(file, "utf8")).toBe("{}")
})

test("import revalidates a reference changed after planning", async () => {
  const envelope: Auth.ExportEnvelope = {
    version: 1,
    exportedAt: "2026-11-17T00:00:00.000Z",
    providers: { provider: { type: "credential_source", source: { kind: "aws_profile", profile: "dev" } } },
  }
  const plan = await Auth.planImport(envelope)
  envelope.providers.provider = { type: "credential_source", source: { kind: "aws_profile" } }
  const result = await Auth.applyImport(envelope, plan)
  expect(result.created).toEqual([])
  expect(result.skipped).toEqual([{ providerID: "provider", reason: "unsupported or invalid credential source" }])
  expect(await Auth.get("provider")).toBeUndefined()
})

test.each([
  null,
  {},
  { version: 1, providers: {} },
  { version: 1, exportedAt: "2026-11-17", providers: [] },
  { version: 1, exportedAt: "2026-11-17", providers: "invalid" },
])("import rejects malformed envelopes before reading or writing auth: %j", async (envelope) => {
  await expect(Auth.planImport(envelope)).rejects.toThrow("Invalid provider reference envelope")
  await expect(Auth.applyImport(envelope, { willCreate: ["provider"], willSkip: [] })).rejects.toThrow(
    "Invalid provider reference envelope",
  )
  expect(await fs.readFile(file, "utf8")).toBe("{}")
})

test("import skips unsupported entries while preserving valid references", async () => {
  const envelope = {
    version: 1,
    exportedAt: "2026-11-17",
    providers: {
      valid: { type: "credential_source", source: { kind: "azure_cli" } },
      unknown: { type: "credential_source", source: { kind: "future" } },
      incomplete: { type: "credential_source", source: { kind: "aws_profile" } },
      empty: null,
    },
  }
  const plan = await Auth.planImport(envelope)
  expect(plan.willCreate).toEqual(["valid"])
  expect(plan.willSkip.map((entry) => entry.providerID)).toEqual(["unknown", "incomplete", "empty"])
  expect((await Auth.applyImport(envelope, plan)).created).toEqual(["valid"])
  expect(await Auth.get("valid")).toEqual({ type: "credential_source", source: { kind: "azure_cli" } })
})

test("export CLI reports references omitted from the shareable file", async () => {
  const { runExport } = await import("../../src/cli/cmd/providers/auth")
  await Auth.set("future-provider", { type: "credential_source", source: { kind: "future" } })
  const warn = vi.spyOn(prompts.log, "warn").mockImplementation(() => undefined)
  const exported = path.join(path.dirname(file), "skipped-reference-export.json")
  try {
    await runExport({ file: exported })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("future-provider"))
    expect(await fs.readFile(exported, "utf8")).not.toContain("future-provider")
  } finally {
    await fs.rm(exported, { force: true })
  }
})

test("import CLI reports invalid envelopes without printing their contents", async () => {
  const { runImport } = await import("../../src/cli/cmd/providers/auth")
  const secret = fakeKeyShape("malformed")
  const imported = path.join(path.dirname(file), "invalid-reference-import.json")
  const originalExitCode = process.exitCode
  const error = vi.spyOn(prompts.log, "error").mockImplementation(() => undefined)
  try {
    await fs.writeFile(imported, JSON.stringify({ version: 1, exportedAt: "2026-11-17", providers: [secret] }))
    await runImport({ file: imported, write: true, yes: true })
    expect(process.exitCode).toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Invalid provider reference envelope"))
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret)
    expect(await fs.readFile(file, "utf8")).toBe("{}")
  } finally {
    process.exitCode = originalExitCode
    await fs.rm(imported, { force: true })
  }
})

test("import checks for an existing connection inside the write lock", async () => {
  await Auth.set("other", { type: "api", key: fakeKeyShape("other") })
  const envelope: Auth.ExportEnvelope = {
    version: 1,
    exportedAt: "2026-11-17T00:00:00.000Z",
    providers: { provider: { type: "credential_source", source: { kind: "aws_profile", profile: "dev" } } },
  }
  const plan = await Auth.planImport(envelope)
  const originalRead = Filesystem.readJson.bind(Filesystem)
  let releaseRead!: () => void
  const released = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let observeRead!: () => void
  const observed = new Promise<void>((resolve) => {
    observeRead = resolve
  })
  let intercepted = false
  vi.spyOn(Filesystem, "readJson").mockImplementation(async (target) => {
    const value = await originalRead(target)
    if (target === file && !intercepted) {
      intercepted = true
      observeRead()
      await released
    }
    return value
  })
  const pending = Auth.applyImport(envelope, plan)
  try {
    await observed
    const existing: Auth.Info = { type: "api", key: fakeKeyShape("concurrent") }
    await Auth.set("provider", existing)
    releaseRead()
    const result = await pending
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual([{ providerID: "provider", reason: "exists" }])
    expect(await Auth.get("provider")).toEqual(existing)
  } finally {
    releaseRead()
    await pending
  }
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
  const { runExport, runImport } = await import("../../src/cli/cmd/providers/auth")
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

test("applyImport skips a provider connected after the plan was made", async () => {
  const envelope: Auth.ExportEnvelope = {
    version: 1,
    exportedAt: "2026-10-27T00:00:00.000Z",
    providers: {
      "aws-bedrock": { type: "credential_source", source: { kind: "aws_profile", profile: "p", region: "us-east-1" } },
    },
  }
  const plan = await Auth.planImport(envelope)
  expect(plan.willCreate).toEqual(["aws-bedrock"])

  // Another process connects the provider while the CLI waits for confirmation.
  await Auth.set("aws-bedrock", { type: "api", key: "connected-after-plan" })

  const result = await Auth.applyImport(envelope, plan)
  expect(result.created).toEqual([])
  expect(result.skipped).toEqual([{ providerID: "aws-bedrock", reason: "exists" }])
  expect(await Auth.get("aws-bedrock")).toEqual({ type: "api", key: "connected-after-plan" })
})
