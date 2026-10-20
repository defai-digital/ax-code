import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"
import path from "node:path"
import { artifactDir, packageRoot, publicManifest } from "../packages/sdk/js/script/github-package.mjs"
import {
  downloadPackage,
  registryRequest,
  validateTag,
  verifyRegistry,
} from "../.github/scripts/sdk-package-registry.mjs"

const source = {
  name: "@ax-code/sdk",
  private: true,
  version: "2.6.39",
  exports: { ".": "./dist/index.js" },
  dependencies: { zod: "catalog:" },
  scripts: { preinstall: "must not ship" },
  devDependencies: { secret: "1.0.0" },
}
const catalog = 'catalog:\n  "zod": "4.4.3"\n'

describe("SDK package boundary", () => {
  test("ships a private-workspace-safe typed package with resolved pinned runtime dependencies", () => {
    const manifest = publicManifest(source, catalog)
    expect(manifest.name).toBe("@defai-digital/ax-code-sdk")
    expect(manifest.dependencies).toEqual({ zod: "4.4.3" })
    expect(manifest.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" })
    expect(manifest.publishConfig).toEqual({ registry: "https://npm.pkg.github.com", access: "restricted" })
    for (const key of ["scripts", "devDependencies", "private", "packageManager"])
      expect(manifest).not.toHaveProperty(key)
  })
  test.each([
    "workspace:*",
    "file:../secret",
    "link:../secret",
    "jsr:other",
    "catalog:missing",
    "https://example.com/x.tgz",
    "^4.0.0",
  ])("rejects unresolved or nonpinned runtime dependency %s", (version) => {
    expect(() => publicManifest({ ...source, dependencies: { zod: version } }, catalog)).toThrow()
  })
  test.each(["../secret.js", "./dist/../../secret.js", "./src/index.ts"])(
    "rejects escaping or source export %s",
    (target) => {
      expect(() => publicManifest({ ...source, exports: { ".": target } }, catalog)).toThrow()
    },
  )
  test("requires matching immutable SDK tags", () => {
    expect(validateTag("sdk-v2.6.39", "2.6.39")).toBe("sdk-v2.6.39")
    expect(() => validateTag("main", "2.6.39")).toThrow()
    expect(() => validateTag("sdk-v2.6.38", "2.6.39")).toThrow()
  })
})

describe("authenticated SDK readback", () => {
  const bytes = Buffer.from("candidate tarball")
  const receipt = {
    registry: "https://npm.pkg.github.com",
    name: "@defai-digital/ax-code-sdk",
    version: "2.6.39",
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  const metadata = (dist = {}) => ({
    name: receipt.name,
    version: receipt.version,
    dist: { integrity: receipt.integrity, tarball: "https://npm.pkg.github.com/download/sdk", ...dist },
  })
  test("accepts only exact candidate integrity and downloaded bytes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: receipt.name, versions: { [receipt.version]: metadata() } }))
      .mockResolvedValueOnce(new Response(bytes))
    expect(await verifyRegistry(receipt, bytes, "fixture-token", fetcher)).toEqual(bytes)
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/%40defai-digital%2Fax-code-sdk")
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { authorization: "Bearer fixture-token" },
    })
  })
  test("fails closed on mismatched integrity or tarball bytes", async () => {
    const wrongIntegrity = vi
      .fn()
      .mockResolvedValue(
        Response.json({ name: receipt.name, versions: { [receipt.version]: metadata({ integrity: "sha512-other" }) } }),
      )
    await expect(verifyRegistry(receipt, bytes, "fixture-token", wrongIntegrity)).rejects.toThrow("integrity mismatch")
    expect(wrongIntegrity).toHaveBeenCalledTimes(1)
    const wrongBytes = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: receipt.name, versions: { [receipt.version]: metadata() } }))
      .mockResolvedValueOnce(new Response("different bytes"))
    await expect(verifyRegistry(receipt, bytes, "fixture-token", wrongBytes)).rejects.toThrow()
  })
  test.each([401, 403, 404, 500])("rejects registry failure HTTP %s", async (status) => {
    await expect(
      verifyRegistry(receipt, bytes, "fixture-token", async () => new Response("", { status })),
    ).rejects.toThrow(`HTTP ${status}`)
  })
  test("never forwards the token to another host or follows redirects", async () => {
    const fetcher = vi.fn()
    await expect(registryRequest("https://registry.npmjs.org/sdk", "fixture-token", fetcher)).rejects.toThrow(
      "another registry",
    )
    expect(fetcher).not.toHaveBeenCalled()
    const redirected = vi.fn().mockResolvedValueOnce(
      Response.json({
        name: receipt.name,
        versions: { [receipt.version]: metadata({ tarball: "https://example.com/steal" }) },
      }),
    )
    await expect(verifyRegistry(receipt, bytes, "fixture-token", redirected)).rejects.toThrow(
      "must start at the registry",
    )
    expect(redirected).toHaveBeenCalledTimes(1)
  })
})

test("publication requires readback and a separate consumer with read-only package access", () => {
  const workflow = readFileSync(".github/workflows/sdk-github-packages.yml", "utf8")
  const consumer = workflow.slice(workflow.indexOf("\n  consumer:"), workflow.indexOf("\n  release:"))
  expect(consumer).toContain("packages: read")
  expect(consumer).not.toMatch(/packages: write|id-token: write/)
  expect(consumer).toContain("--frozen-lockfile")
  expect(consumer).toContain('export NPM_CONFIG_USERCONFIG="$CONSUMER_DIR/.npmrc"')
  expect(consumer).toContain("sdk-provenance.mjs verify")
  expect(consumer).toContain("sdk-package-registry.mjs verify")
  expect(workflow).not.toContain("--clobber")
})

test("repository dispatch carries only a tag into the same source validation gate", () => {
  const workflow = readFileSync(".github/workflows/sdk-github-packages.yml", "utf8")
  expect(workflow).toContain("types: [publish-sdk]")
  expect(workflow).toContain("inputs.tag || github.event.client_payload.tag || github.ref_name")
  expect(workflow).not.toMatch(/run:.*client_payload/)
  expect(workflow).toContain("node .github/scripts/sdk-package-registry.mjs source")
})

test("release evidence stays outside the SDK build scratch directory", () => {
  const sdkScratch = path.join(packageRoot, ".tmp")
  expect(path.relative(sdkScratch, artifactDir).startsWith(`..${path.sep}`)).toBe(true)
  const workflow = readFileSync(".github/workflows/sdk-github-packages.yml", "utf8")
  expect(workflow).toContain("SDK_ARTIFACT_DIR: .tmp/sdk-github-package")
  expect(workflow).not.toContain("packages/sdk/js/.tmp/github-package")
})

test("GitHub CDN redirects receive no package credential", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://pkg-npm.githubusercontent.com/package?signed=fixture" },
      }),
    )
    .mockResolvedValueOnce(new Response("tarball"))
  const response = await downloadPackage("https://npm.pkg.github.com/download/sdk", "fixture-token", fetcher)
  expect(await response.text()).toBe("tarball")
  expect(fetcher.mock.calls[0][1].headers).toEqual({ authorization: "Bearer fixture-token" })
  expect(fetcher.mock.calls[1][1].headers).toEqual({})
  expect(fetcher.mock.calls.every(([, options]) => options.redirect === "manual")).toBe(true)
})

test.each(["https://example.com/package", "http://pkg-npm.githubusercontent.com/package"])(
  "rejects untrusted package redirects %s",
  async (location) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }))
    await expect(downloadPackage("https://npm.pkg.github.com/download/sdk", "fixture-token", fetcher)).rejects.toThrow(
      "Unexpected package download host",
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)
