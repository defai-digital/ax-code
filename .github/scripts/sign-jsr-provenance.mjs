import assert from "node:assert/strict"
import { attest, verify } from "sigstore"
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
  const sign = () =>
    attest(Buffer.from(JSON.stringify(statement)), "application/vnd.in-toto+json", {
      identityToken,
      legacyCompatibility: true,
      tlogUpload: true,
    })
  const bundle = await sign().catch((error) => {
    // A successful Rekor POST can lose its response, then its transport retry
    // gets 409 for the entry it just created. The SDK discards that bundle.
    // Generate a fresh ephemeral signature once, within JSR's short attachment
    // window. Never accept an unverified entry or retry other signing errors.
    if (error?.code !== "TLOG_CREATE_ENTRY_ERROR" || error?.cause?.statusCode !== 409) throw error
    return sign()
  })
  await verify(bundle, undefined, policy)
  // Validate the exact package subject and legacy conversion before upload.
  await toJsrBundle(bundle, version, digest)
  return bundle
}
