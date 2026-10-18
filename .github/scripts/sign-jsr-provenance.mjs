import assert from "node:assert/strict"
import { verify } from "sigstore"
import { bundleToJSON } from "@sigstore/bundle"
import { DSSEBundleBuilder, FulcioSigner, RekorWitness } from "@sigstore/sign"
import { toJsrBundle, versionFromTag } from "./jsr-provenance-recovery.mjs"

export function signingPolicy(workflowRef) {
  assert.match(
    workflowRef,
    /^defai-digital\/ax-code\/\.github\/workflows\/(?:sdk-jsr|sdk-provenance-qualification)\.yml@refs\/(?:heads\/main|tags\/sdk-v\d+\.\d+\.\d+)$/,
    "Unexpected SDK signing workflow identity",
  )
  const identity = `https://github.com/${workflowRef}`
  return {
    certificateIssuer: "https://token.actions.githubusercontent.com",
    certificateIdentityURI: `^${identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  }
}

// Use the same public Fulcio/Rekor trust services as normal JSR publication.
// This does not depend on GitHub's paid private-repository attestation storage.
// Only package digests and workflow provenance enter the transparency log.
export async function signJsrProvenance({ version, digest, predicate, workflowRef, identityToken }) {
  versionFromTag(`sdk-v${version}`)
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert(predicate && typeof predicate === "object" && !Array.isArray(predicate))
  const policy = signingPolicy(workflowRef)
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `pkg:jsr/@defai-digital/ax-code-sdk@${version}`, digest: { sha256: digest } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate,
  }
  const builder = new DSSEBundleBuilder({
    certificateChain: true,
    signer: new FulcioSigner({
      identityProvider: { getToken: async () => identityToken },
      retry: { retries: 2 },
      timeout: 5000,
    }),
    witnesses: [
      new RekorWitness({
        entryType: "intoto",
        // A retried POST can report an entry that Rekor already accepted.
        // Recover that entry through the library, then verify its signature,
        // inclusion and exact workflow identity before allowing attachment.
        fetchOnConflict: true,
        retry: { retries: 2 },
        timeout: 5000,
      }),
    ],
  })
  const bundle = bundleToJSON(
    await builder.create({ data: Buffer.from(JSON.stringify(statement)), type: "application/vnd.in-toto+json" }),
  )
  // For DSSE bundles the verification options are the second argument.
  await verify(bundle, policy)
  // Validate the exact package subject and legacy conversion before upload.
  await toJsrBundle(bundle, version, digest)
  return bundle
}
