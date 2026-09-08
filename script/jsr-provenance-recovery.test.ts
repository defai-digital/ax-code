import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  digest,
  expectedFiles,
  toJsrBundle,
  verifyManifest,
  versionFromTag,
} from "../.github/scripts/jsr-provenance-recovery.mjs"

const bytes = Buffer.from("export const value = 1\n")
const files = new Map([["/dist/index.js", bytes]])
const metadata = () => ({ manifest: { "/dist/index.js": { size: bytes.length, checksum: `sha256-${digest(bytes)}` } } })
const encode = (value: unknown) => Buffer.from(JSON.stringify(value))

describe("SDK provenance recovery", () => {
  test("reconstructs registry imports without rewriting ordinary string values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ax-jsr-recovery-"))
    try {
      const sdk = path.join(root, "packages/sdk/js")
      await fs.mkdir(path.join(sdk, "dist"), { recursive: true })
      await fs.mkdir(path.join(sdk, "script"))
      await fs.symlink(path.join(process.cwd(), "node_modules"), path.join(root, "node_modules"), "junction")
      await fs.writeFile(path.join(root, "package.json"), "{}")
      await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), 'catalog:\n  "zod": "4.3.6"\n')
      await fs.writeFile(path.join(root, "LICENSE"), "Apache-2.0\n")
      await fs.writeFile(
        path.join(sdk, "package.json"),
        JSON.stringify({ version: "2.5.10", dependencies: { zod: "catalog:" } }),
      )
      await fs.writeFile(
        path.join(sdk, "jsr.json"),
        JSON.stringify({ name: "@defai-digital/ax-code-sdk", version: "2.5.10" }),
      )
      await fs.writeFile(path.join(sdk, "script/jsr-package-settings.ts"), 'export const JSR_DESCRIPTION = "SDK"\n')
      for (const name of ["README.md", "ARCHITECTURE.md"]) await fs.writeFile(path.join(sdk, name), "SDK\n")
      await fs.writeFile(path.join(sdk, "dist/index.js"), 'import { z } from "zod"; export const label = "zod";\n')
      await fs.writeFile(path.join(sdk, "dist/index.d.ts"), 'export * from "./types.js";\n')
      await fs.writeFile(path.join(sdk, "dist/types.d.ts"), "export type Value = string;\n")
      const reconstructed = await expectedFiles(root, "sdk-v2.5.10")
      expect(reconstructed.get("/dist/index.js").toString()).toContain(
        'from "npm:zod@4.3.6"; export const label = "zod"',
      )
      expect(reconstructed.get("/dist/index.d.ts").toString()).toContain('from "./types.d.ts"')
      await expect(expectedFiles(root, "sdk-v2.5.9")).rejects.toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("accepts only stable SDK release tags", () => {
    expect(versionFromTag("sdk-v2.5.10")).toBe("2.5.10")
    for (const tag of ["main", "v2.5.10", "sdk-v2.5.10/../main", "sdk-v2.5.10-beta"]) {
      expect(() => versionFromTag(tag)).toThrow()
    }
  })

  test("hashes the exact published manifest after checking every file", async () => {
    const manifest = encode(metadata())
    expect(await verifyManifest(manifest, files)).toBe(digest(manifest))
    await expect(verifyManifest(encode({ manifest: {} }), files)).rejects.toThrow("file set differs")
    const extra = metadata()
    extra.manifest["/extra.js"] = { size: 0, checksum: `sha256-${digest("")}` }
    await expect(verifyManifest(encode(extra), files)).rejects.toThrow("file set differs")
    await expect(
      verifyManifest(manifest, new Map([["/dist/index.js", Buffer.from("export const value = 2\n")]])),
    ).rejects.toThrow("checksum differs")
    await expect(verifyManifest(manifest, new Map([["/dist/index.js", Buffer.from("short")]]))).rejects.toThrow(
      "size differs",
    )
  })

  test("binds the converted attestation to the exact package version and manifest", async () => {
    const hash = digest("manifest")
    const bundle = {
      dsseEnvelope: {
        payloadType: "application/vnd.in-toto+json",
        payload: encode({
          subject: [{ name: "pkg:jsr/@defai-digital/ax-code-sdk@2.5.10", digest: { sha256: hash } }],
        }).toString("base64"),
        signatures: [{ sig: "signature" }],
      },
      verificationMaterial: { certificate: { rawBytes: "certificate" }, tlogEntries: [{ logIndex: "123" }] },
    }
    const result = await toJsrBundle(bundle, "2.5.10", hash)
    expect(result.verificationMaterial.tlogEntries).toEqual([{ logIndex: 123 }])
    await expect(toJsrBundle(bundle, "2.5.9", hash)).rejects.toThrow()
    await expect(toJsrBundle(bundle, "2.5.10", digest("other"))).rejects.toThrow()
    await expect(toJsrBundle({ ...bundle, verificationMaterial: {} }, "2.5.10", hash)).rejects.toThrow()
  })
})
