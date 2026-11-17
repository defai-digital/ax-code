import z from "zod"

// ADR-246: only these reviewed, non-secret reference fields can cross the
// auth export/import boundary. Object schemas strip unrecognized fields;
// the auth store separately retains its permissive shape for compatibility.
export const CredentialSourceReference = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("aws_profile"),
    profile: z.string().min(1),
    region: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("gcloud_adc"),
    project: z.string().min(1),
    location: z.string().min(1),
  }),
  z.object({
    kind: z.literal("azure_cli"),
    tenant: z.string().min(1).optional(),
    subscription: z.string().min(1).optional(),
  }),
])
