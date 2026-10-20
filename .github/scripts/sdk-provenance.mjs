import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { verify } from "sigstore"
import { artifactDir } from "../../packages/sdk/js/script/github-package.mjs"
import { sourceReceipt } from "./sdk-package-registry.mjs"
import { signSdkProvenance, signingPolicy } from "./sign-sdk-provenance.mjs"

const receipt = JSON.parse(await fs.readFile(path.join(artifactDir, "package-receipt.json"), "utf8"))
const source = JSON.parse(await fs.readFile(path.join(artifactDir, "source-receipt.json"), "utf8"))
assert.deepEqual(source, await sourceReceipt(process.env.AX_CODE_SDK_RELEASE_TAG))
assert.equal(source.publisherCommit, process.env.GITHUB_SHA)
const bundlePath = path.join(artifactDir, "provenance.sigstore.json")
const workflowRef = process.env.GITHUB_WORKFLOW_REF
const predicate = {
  buildDefinition: {
    buildType: "https://github.com/defai-digital/ax-code/sdk-package/v1",
    externalParameters: { registry: receipt.registry, tag: source.tag },
    resolvedDependencies: [
      {
        uri: `git+https://github.com/defai-digital/ax-code@refs/tags/${source.tag}`,
        digest: { gitCommit: source.sourceCommit },
      },
    ],
  },
  runDetails: {
    builder: { id: `https://github.com/${workflowRef}` },
    metadata: {
      invocationId: `https://github.com/defai-digital/ax-code/actions/runs/${process.env.GITHUB_RUN_ID}`,
      publisherCommit: source.publisherCommit,
      publisherLockSha256: source.publisherLockSha256,
    },
  },
}
if (process.argv[2] === "sign") {
  const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
  tokenUrl.searchParams.set("audience", "sigstore")
  const response = await fetch(tokenUrl, {
    headers: { authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  })
  assert(response.ok, `OIDC request failed: HTTP ${response.status}`)
  const { value: identityToken } = await response.json()
  assert.equal(typeof identityToken, "string")
  const bundle = await signSdkProvenance({
    version: receipt.version,
    digest: receipt.sha256,
    predicate,
    workflowRef,
    identityToken: identityToken,
  })
  await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2) + "\n")
} else if (process.argv[2] === "verify") {
  const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"))
  await verify(bundle, signingPolicy(workflowRef))
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"))
  assert.equal(statement._type, "https://in-toto.io/Statement/v1")
  assert.equal(statement.predicateType, "https://slsa.dev/provenance/v1")
  assert.deepEqual(statement.subject, [
    { name: `pkg:npm/%40defai-digital/ax-code-sdk@${receipt.version}`, digest: { sha256: receipt.sha256 } },
  ])
  assert.deepEqual(statement.predicate, predicate)
  console.log("SDK provenance signature, identity, subject, source and publisher verified")
} else throw new Error("Expected sign or verify")
