import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { publicManifest, registry, artifactDir } from "../../packages/sdk/js/script/github-package.mjs"

export function validateTag(tag, version) {
  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.equal(tag, `sdk-v${version}`, "SDK release tag must match package version")
  return tag
}

export async function sourceReceipt(tag) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
  const workspace = JSON.parse(await fs.readFile("packages/sdk/js/package.json", "utf8"))
  validateTag(tag, workspace.version)
  const ref = `refs/tags/${tag}`
  const sourceCommit = git("rev-parse", `${ref}^{commit}`)
  const publisherCommit = git("rev-parse", "HEAD")
  // The publisher may be newer during the registry cutover. Its API and
  // generator inputs must still equal the immutable SDK tag, including files
  // outside the generated clients. Never retag an existing runtime release.
  git(
    "diff",
    "--exit-code",
    ref,
    "HEAD",
    "--",
    "packages/sdk/js/src",
    "packages/sdk/proto",
    "packages/sdk/openapi.json",
    "packages/ax-code/src",
    "packages/sdk/js/script/build.ts",
    "packages/sdk/js/script/document-generated.ts",
  )
  const sourceManifest = JSON.parse(git("show", `${ref}:packages/sdk/js/package.json`))
  const sourceCatalog = git("show", `${ref}:pnpm-workspace.yaml`)
  const currentCatalog = await fs.readFile("pnpm-workspace.yaml", "utf8")
  assert.deepEqual(
    publicManifest(workspace, currentCatalog),
    publicManifest(sourceManifest, sourceCatalog),
    "SDK distribution contract differs from source tag",
  )
  return {
    tag,
    sourceCommit,
    publisherCommit,
    publisherLockSha256: createHash("sha256")
      .update(await fs.readFile("pnpm-lock.yaml"))
      .digest("hex"),
  }
}

export async function registryRequest(url, token, fetcher = fetch, redirect = "error") {
  const target = new URL(url)
  assert.equal(target.origin, registry, "Refuse to send package token to another registry")
  assert(!target.username && !target.password && !target.hash)
  assert(token, "NODE_AUTH_TOKEN is required")
  const response = await fetcher(target, {
    headers: { authorization: `Bearer ${token}` },
    redirect,
    signal: AbortSignal.timeout(30_000),
  })
  return response
}

export async function downloadPackage(url, token, fetcher = fetch) {
  let target = new URL(url)
  assert.equal(target.origin, registry, "Package download must start at the registry")
  for (let redirects = 0; redirects <= 3; redirects++) {
    assert(!target.username && !target.password && !target.hash)
    assert(
      target.origin === registry || target.origin === "https://pkg-npm.githubusercontent.com",
      "Unexpected package download host",
    )
    const response =
      target.origin === registry
        ? await registryRequest(target, token, fetcher, "manual")
        : await fetcher(target, { headers: {}, redirect: "manual", signal: AbortSignal.timeout(30_000) })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    assert(location, "Missing package redirect location")
    await response.body?.cancel()
    target = new URL(location, target)
  }
  throw new Error("Package redirect limit exceeded")
}

export async function verifyPublicPackage(token, fetcher = fetch) {
  assert(token, "A package credential is required")
  const response = await fetcher("https://api.github.com/orgs/defai-digital/packages/npm/ax-code-sdk", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  })
  assert(response.ok, `Package visibility read failed: HTTP ${response.status}`)
  const metadata = await response.json()
  assert.equal(metadata.name, "ax-code-sdk")
  assert.equal(metadata.visibility, "public", "SDK package must remain public")
  return { visibility: metadata.visibility }
}

export async function verifyRegistry(receipt, candidate, token, fetcher = fetch) {
  assert.equal(receipt.registry, registry)
  assert.equal(receipt.name, "@defai-digital/ax-code-sdk")
  validateTag(`sdk-v${receipt.version}`, receipt.version)
  const metadata = await registryRequest(`${registry}/${encodeURIComponent(receipt.name)}`, token, fetcher)
  assert(metadata.ok, `Package metadata read failed: HTTP ${metadata.status}`)
  // GitHub Packages exposes a full packument; its /<version> route returns 405.
  const packument = await metadata.json()
  assert.equal(packument.name, receipt.name)
  const manifest = packument.versions?.[receipt.version]
  assert(manifest, "Published SDK version is missing from registry metadata")
  assert.equal(manifest.name, receipt.name)
  assert.equal(manifest.version, receipt.version)
  assert.equal(manifest.dist?.integrity, receipt.integrity, "Published SDK integrity mismatch")
  const response = await downloadPackage(manifest.dist.tarball, token, fetcher)
  assert(response.ok, `Package tarball read failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, receipt.integrity)
  assert.equal(createHash("sha256").update(bytes).digest("hex"), receipt.sha256)
  assert(bytes.equals(candidate), "Registry tarball differs from candidate bytes")
  return bytes
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = process.argv[2]
  if (command === "visibility") {
    console.log(JSON.stringify(await verifyPublicPackage(process.env.NODE_AUTH_TOKEN)))
  } else if (command === "source") {
    const receipt = await sourceReceipt(process.env.AX_CODE_SDK_RELEASE_TAG)
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(path.join(artifactDir, "source-receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
  } else if (command === "verify") {
    const receipt = JSON.parse(await fs.readFile(path.join(artifactDir, "package-receipt.json"), "utf8"))
    const bytes = await verifyRegistry(
      receipt,
      await fs.readFile(path.join(artifactDir, receipt.filename)),
      process.env.NODE_AUTH_TOKEN,
    )
    await fs.writeFile(path.join(artifactDir, "registry-readback.tgz"), bytes)
    console.log(`Authenticated registry bytes verified: ${receipt.name}@${receipt.version}`)
  } else throw new Error("Expected source, visibility or verify")
}
