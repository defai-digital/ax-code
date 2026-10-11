import { describe, expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  assertArchiveSet,
  checkPublicArchives,
  cloudflareObjectStore,
  loadBootstrapManifest,
  publicObjectUrl,
  publishVerifiedArchives,
  readBootstrapManifest,
  sha256Hex,
  type BootstrapManifest,
} from "./publish-minisign-bootstrap"

const root = path.resolve(import.meta.dirname, "..")

function manifestWith(bytes: Uint8Array): BootstrapManifest {
  const hash = sha256Hex(bytes)
  return loadBootstrapManifest(
    JSON.stringify({
      schema: "ax-code.minisign-bootstrap.v1",
      version: "0.12",
      publicOrigin: "https://download.ax-code.com",
      objectPrefix: "vendor/minisign/0.12",
      upstreamPrefix: "https://github.com/jedisct1/minisign/releases/download/0.12",
      archives: [{ name: "minisign-0.12-macos.zip", sha256: hash, executables: [{ path: "minisign", sha256: hash }] }],
    }),
  )
}

describe("minisign bootstrap publisher", () => {
  test("loads the pinned public manifest", () => {
    const manifest = readBootstrapManifest()
    expect(manifest.archives.map((archive) => archive.name)).toEqual([
      "minisign-0.12-macos.zip",
      "minisign-0.12-linux.tar.gz",
      "minisign-0.12-win64.zip",
    ])
    expect(publicObjectUrl(manifest, "minisign-0.12-macos.zip")).toBe(
      "https://download.ax-code.com/vendor/minisign/0.12/minisign-0.12-macos.zip",
    )
    expect(manifest.upstreamPrefix).toBe("https://github.com/jedisct1/minisign/releases/download/0.12")
  })

  test("rejects a directory that is not the exact archive set", () => {
    const manifest = readBootstrapManifest()
    const files = new Map<string, Uint8Array>([["extra.zip", Buffer.from("no")]])
    expect(() => assertArchiveSet(files, manifest)).toThrow(/unknown: extra.zip/)
    expect(() => assertArchiveSet(new Map(), manifest)).toThrow(/missing:/)
  })

  test("refuses to replace an object whose bytes differ", async () => {
    const bytes = Buffer.from("pinned-bytes")
    const manifest = manifestWith(bytes)
    let writes = 0
    await expect(
      publishVerifiedArchives({
        manifest,
        files: new Map([["minisign-0.12-macos.zip", bytes]]),
        objects: {
          async read() {
            return Buffer.from("different")
          },
          async write() {
            writes += 1
          },
        },
        readPublic: async () => bytes,
      }),
    ).rejects.toThrow("Refusing to replace")
    expect(writes).toBe(0)
  })

  test("uploads a missing object and verifies the stored and public bytes", async () => {
    const bytes = Buffer.from("pinned-bytes")
    const manifest = manifestWith(bytes)
    let stored: Uint8Array | null = null
    const urls: string[] = []
    const result = await publishVerifiedArchives({
      manifest,
      files: new Map([["minisign-0.12-macos.zip", bytes]]),
      objects: {
        async read() {
          return stored
        },
        async write(_key, body) {
          stored = body
        },
      },
      readPublic: async (url) => {
        urls.push(url)
        return bytes
      },
    })
    expect(result.uploaded).toEqual(["minisign-0.12-macos.zip"])
    expect(stored && sha256Hex(stored)).toBe(sha256Hex(bytes))
    expect(urls).toEqual([publicObjectUrl(manifest, "minisign-0.12-macos.zip")])
  })

  test("leaves a matching object unchanged", async () => {
    const bytes = Buffer.from("pinned-bytes")
    const manifest = manifestWith(bytes)
    let writes = 0
    const result = await publishVerifiedArchives({
      manifest,
      files: new Map([["minisign-0.12-macos.zip", bytes]]),
      objects: {
        async read() {
          return bytes
        },
        async write() {
          writes += 1
        },
      },
      readPublic: async () => bytes,
    })
    expect(result.unchanged).toEqual(["minisign-0.12-macos.zip"])
    expect(writes).toBe(0)
  })

  test("fails the public check when the served bytes differ", async () => {
    const manifest = manifestWith(Buffer.from("pinned-bytes"))
    await expect(checkPublicArchives(manifest, async () => Buffer.from("tampered"))).rejects.toThrow(
      "Public minisign bootstrap SHA-256 mismatch",
    )
  })

  test("requires explicit Cloudflare credentials before creating a store", () => {
    expect(() => cloudflareObjectStore({})).toThrow("CLOUDFLARE_ACCOUNT_ID")
  })

  test("release publish checks the public mirror before publication", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8")
    const verify = workflow.indexOf("script/publish-minisign-bootstrap.ts --check-public")
    const publish = workflow.indexOf("name: Publish verified release")
    expect(verify).toBeGreaterThan(0)
    expect(publish).toBeGreaterThan(verify)
  })

  test("rejects duplicate archive names", () => {
    const bytes = Buffer.from("pinned-bytes")
    const hash = sha256Hex(bytes)
    const archive = { name: "minisign-0.12-macos.zip", sha256: hash, executables: [{ path: "minisign", sha256: hash }] }
    expect(() =>
      loadBootstrapManifest(
        JSON.stringify({
          schema: "ax-code.minisign-bootstrap.v1",
          version: "0.12",
          publicOrigin: "https://download.ax-code.com",
          objectPrefix: "vendor/minisign/0.12",
          upstreamPrefix: "https://github.com/jedisct1/minisign/releases/download/0.12",
          archives: [archive, archive],
        }),
      ),
    ).toThrow("Duplicate minisign bootstrap archive")
  })
})
