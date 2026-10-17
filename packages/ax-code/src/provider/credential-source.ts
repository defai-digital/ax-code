// ADR-246: external credential source references.
//
// Providers like AWS Bedrock, Google Vertex, and Azure can resolve their
// credentials through client-side chains (AWS profile, Application Default
// Credentials, Azure CLI). Storing the resolved secret inside AX Code would
// duplicate the client-side tooling and re-introduce every rotation / hygiene
// burden that the chain is meant to handle. These types only store the
// reference — the provider SDK (or a thin shim around it) re-resolves on each
// request.
//
// Only references are exported by `ax-code auth export`. The auth store keeps
// storing the encrypted secret-shaped entries (api / oauth / wellknown); a
// new auth-store variant `credential_source` exists for the cases where the
// reference must live alongside the other auth entries (e.g. for `ax-code
// auth import` to know which provider ids to recreate).

import z from "zod"
import { ProviderID } from "./schema"

export namespace CredentialSource {
  export const AwsProfile = z
    .object({
      kind: z.literal("aws_profile"),
      profile: z.string().min(1).describe("Named profile in ~/.aws/config or ~/.aws/credentials"),
      region: z.string().min(1).optional().describe("AWS region override (e.g. us-east-1)"),
    })
    .meta({ ref: "CredentialSourceAwsProfile" })
  export type AwsProfile = z.infer<typeof AwsProfile>

  export const GcloudAdc = z
    .object({
      kind: z.literal("gcloud_adc"),
      // project + location (region) are required by the Vertex SDK. They are
      // not secret, but they are needed to dispatch a request, so we store
      // them alongside the source reference.
      project: z.string().min(1).describe("GCP project id"),
      location: z.string().min(1).describe("Vertex AI region/location (e.g. us-central1)"),
    })
    .meta({ ref: "CredentialSourceGcloudAdc" })
  export type GcloudAdc = z.infer<typeof GcloudAdc>

  export const AzureCli = z
    .object({
      kind: z.literal("azure_cli"),
      // tenant id is non-secret; subscription id is the routing key.
      tenant: z.string().min(1).optional().describe("Azure tenant id; falls back to `az account show`"),
      subscription: z
        .string()
        .min(1)
        .optional()
        .describe("Azure subscription id; falls back to the active `az account set` subscription"),
    })
    .meta({ ref: "CredentialSourceAzureCli" })
  export type AzureCli = z.infer<typeof AzureCli>

  export const Source = z.discriminatedUnion("kind", [AwsProfile, GcloudAdc, AzureCli]).meta({
    ref: "CredentialSource",
  })
  export type Source = z.infer<typeof Source>

  // Auth-store variant. Lives in auth.json next to api / oauth / wellknown so
  // `auth import` can reconstruct references exactly the way the user had
  // them. No sensitive field is ever encrypted here: the type is structurally
  // non-secret, and any future addition that becomes secret MUST add a new
  // encrypted field rather than reusing `Source`.
  export const AuthEntry = z
    .object({
      type: z.literal("credential_source"),
      source: Source,
    })
    .meta({ ref: "CredentialSourceAuthEntry" })
  export type AuthEntry = z.infer<typeof AuthEntry>

  /** Source kinds the loaders can actually wire today. Any kind not in this
   * set is stored verbatim but the loaders refuse to instantiate an SDK for
   * it — callers should fall back to the existing api/oauth entry. */
  export const SUPPORTED_NPM_KINDS: Readonly<Record<string, ReadonlyArray<Source["kind"]>>> = {
    "@ai-sdk/amazon-bedrock": ["aws_profile"],
    "@ai-sdk/google-vertex": ["gcloud_adc"],
    // The @ai-sdk/azure SDK does not accept a credential provider in the same
    // shape as Bedrock / Vertex. We still store the reference so the doctor
    // row can verify `az` is logged in, but the SDK call is not implemented
    // in this revision — see the final report.
    "@ai-sdk/azure": [],
  }

  export function supportedKindsFor(npm: string | undefined): ReadonlyArray<Source["kind"]> {
    if (!npm) return []
    return SUPPORTED_NPM_KINDS[npm] ?? []
  }

  export function isValidProviderID(value: string): boolean {
    try {
      ProviderID.make(value)
      return true
    } catch {
      return false
    }
  }
}
