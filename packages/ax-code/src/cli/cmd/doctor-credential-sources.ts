// ADR-246: doctor row `credential-sources`.
//
// For every provider whose auth entry is a `credential_source` reference, ask
// the underlying client whether the reference currently resolves. We never
// read the secret; we only confirm that the named profile exists, the ADC
// file is present, or the `az` CLI reports a logged-in account. Failures
// surface as warnings — providers stay listed so a user can still see which
// references the system knows about.
//
// Everything is injectable: the doctor row never shells out during tests, and
// the production runner is a 3 s bounded `Process.run`.

import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { Process } from "../../util/process"
import type { DoctorCheck } from "./doctor-health"
import { Auth } from "../../auth"

export type CredentialSourcesDeps = {
  /** Read all auth entries. Injected so tests can pass a literal record. */
  readAuth?: () => Promise<Record<string, Auth.Info>>
  /** Check an AWS profile by name. */
  awsProfileExists?: (profile: string) => Promise<{ ok: boolean; detail: string }>
  /** Check Google ADC presence. */
  adcPresent?: () => Promise<{ ok: boolean; detail: string }>
  /** Run `az account get-access-token` (or any small probe) to verify login. */
  azLoggedIn?: (timeoutMs: number) => Promise<{ ok: boolean; detail: string }>
  /** Get the effective Config (used to look up non-secret provider options). */
  readConfig?: () => Promise<Config.Info | undefined>
}

const DEFAULT_AWS_TIMEOUT_MS = 3_000

async function defaultAwsProfileExists(profile: string) {
  // The profile must appear in either ~/.aws/config or ~/.aws/credentials by
  // NAME only — we never read the secret value. We use `aws configure list
  // --profile <name>` to confirm AWS sees the profile; the call is read-only
  // and returns the profile metadata without exposing any keys.
  const result = await Process.run(["aws", "configure", "list", "--profile", profile], {
    timeout: DEFAULT_AWS_TIMEOUT_MS,
    nothrow: true,
  }).catch((error) => ({ code: -1, stdout: Buffer.from(""), stderr: Buffer.from(String(error)) }))
  if (result.code === 0) return { ok: true, detail: `profile ${profile} resolvable via AWS CLI` }
  const stderr = result.stderr?.toString().trim() ?? ""
  return { ok: false, detail: `profile ${profile} not found in AWS config/credentials${stderr ? ` (${stderr})` : ""}` }
}

async function defaultAdcPresent() {
  // GOOGLE_APPLICATION_CREDENTIALS points at a JSON file with the service
  // account key. We confirm the file is reachable; we never read the file.
  const envValue = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  if (envValue) {
    const fs = await import("fs/promises")
    try {
      await fs.access(envValue)
      return { ok: true, detail: `GOOGLE_APPLICATION_CREDENTIALS=${envValue}` }
    } catch {
      return { ok: false, detail: `GOOGLE_APPLICATION_CREDENTIALS=${envValue} not readable` }
    }
  }
  // Fall back to the well-known ADC location. We only check presence.
  const fs = await import("fs/promises")
  const os = await import("os")
  const path = await import("path")
  const adcPath = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json")
  try {
    await fs.access(adcPath)
    return { ok: true, detail: `ADC file present at ${adcPath}` }
  } catch {
    return {
      ok: false,
      detail: `no GOOGLE_APPLICATION_CREDENTIALS and no ADC file at ${adcPath}; run \`gcloud auth application-default login\``,
    }
  }
}

async function defaultAzLoggedIn(timeoutMs: number) {
  // `az account get-access-token` returns a token if a user (or service
  // principal) is logged in, and exits non-zero otherwise. We discard stdout
  // (it carries a real access token) so the secret never leaves this
  // process via logs. We only report the exit code and the truncated
  // account id, which is non-secret.
  const result = await Process.run(["az", "account", "get-access-token", "--output", "none"], {
    timeout: timeoutMs,
    nothrow: true,
  }).catch((error) => ({ code: -1, stdout: Buffer.from(""), stderr: Buffer.from(String(error)) }))
  if (result.code === 0) {
    // Best-effort: name the account without leaking secrets.
    const show = await Process.run(["az", "account", "show", "--query", "user.name", "--output", "tsv"], {
      timeout: timeoutMs,
      nothrow: true,
    }).catch(() => undefined)
    const name = show?.stdout?.toString().trim()
    return { ok: true, detail: name ? `az account logged in as ${name}` : "az account logged in" }
  }
  const stderr = result.stderr?.toString().trim() ?? ""
  return { ok: false, detail: `az account not logged in${stderr ? ` (${stderr.slice(0, 80)})` : ""}; run \`az login\`` }
}

function summarizeReference(source: { kind: string } & Record<string, unknown>) {
  switch (source.kind) {
    case "aws_profile":
      return `aws_profile ${source.profile ?? "?"}${source.region ? ` (region ${source.region})` : ""}`
    case "gcloud_adc":
      return `gcloud_adc ${source.project ?? "?"}/${source.location ?? "?"}`
    case "azure_cli":
      return `azure_cli${source.tenant ? ` (tenant ${source.tenant})` : ""}${source.subscription ? ` (subscription ${source.subscription})` : ""}`
    default:
      return `${source.kind}`
  }
}

export async function getCredentialSourcesCheck(input: CredentialSourcesDeps = {}): Promise<DoctorCheck> {
  const readAuth = input.readAuth ?? (() => Auth.all())
  const aws = input.awsProfileExists ?? defaultAwsProfileExists
  const adc = input.adcPresent ?? defaultAdcPresent
  const az = input.azLoggedIn ?? defaultAzLoggedIn
  const readConfig =
    input.readConfig ??
    (async () => {
      try {
        return await Instance.provide({ directory: process.cwd(), fn: () => Config.get() })
      } catch {
        return undefined
      }
    })

  const entries = await readAuth().catch(() => ({}) as Record<string, Auth.Info>)
  const refs: Array<{ providerID: string; source: { kind: string } & Record<string, unknown> }> = []
  for (const [providerID, info] of Object.entries(entries)) {
    if (info.type === "credential_source") {
      refs.push({ providerID, source: info.source as { kind: string } & Record<string, unknown> })
    }
  }
  if (refs.length === 0) {
    return {
      name: "Credential sources",
      status: "ok",
      detail: "no external credential references configured",
    }
  }

  await readConfig() // the doctor row currently only inspects the reference itself; reserved for future per-provider options checks
  const results: Array<{ providerID: string; ok: boolean; detail: string }> = []
  for (const ref of refs) {
    const refKind: string = ref.source.kind
    let probe: { ok: boolean; detail: string } | undefined
    if (refKind === "aws_profile") {
      const profile = typeof ref.source.profile === "string" ? ref.source.profile : ""
      if (!profile) probe = { ok: false, detail: "missing profile name" }
      else probe = await aws(profile)
    } else if (refKind === "gcloud_adc") {
      probe = await adc()
    } else if (refKind === "azure_cli") {
      probe = await az(DEFAULT_AWS_TIMEOUT_MS)
    } else {
      probe = { ok: false, detail: `unsupported source kind ${refKind}` }
    }
    if (probe) results.push({ providerID: ref.providerID, ok: probe.ok, detail: probe.detail })
  }

  const fail = results.filter((r) => !r.ok)
  const pass = results.filter((r) => r.ok)
  const parts: string[] = []
  parts.push(`${results.length} reference${results.length === 1 ? "" : "s"}`)
  if (pass.length) parts.push(`${pass.length} resolvable`)
  if (fail.length) parts.push(`${fail.length} unresolvable`)
  const detail = `${parts.join("; ")} (${results.map((r) => `${r.providerID}: ${summarizeReference(refs.find((x) => x.providerID === r.providerID)!.source)} — ${r.detail}`).join(" | ")})`

  if (fail.length === 0) {
    return { name: "Credential sources", status: "ok", detail }
  }
  return { name: "Credential sources", status: "warn", detail }
}
