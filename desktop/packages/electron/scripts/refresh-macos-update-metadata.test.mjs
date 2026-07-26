import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { refreshMacUpdateArtifacts, refreshMacUpdateMetadataText } from "./refresh-macos-update-metadata.mjs"

const sampleMetadata = `version: 7.3.0
files:
  - url: AX-Code-7.3.0-mac-arm64.zip
    sha512: ZIP_SHA
    size: 123
  - url: AX-Code-7.3.0-mac-arm64.dmg
    sha512: OLD_DMG_SHA
    size: 456
path: AX-Code-7.3.0-mac-arm64.zip
sha512: ZIP_SHA
releaseDate: '2026-07-26T00:00:00.000Z'
`

describe("macOS update metadata refresh", () => {
  test("updates only the matching file entry", () => {
    const refreshed = refreshMacUpdateMetadataText(sampleMetadata, {
      name: "AX-Code-7.3.0-mac-arm64.dmg",
      sha512: "FINAL_DMG_SHA",
      size: 789,
    })

    expect(refreshed).toContain("    sha512: FINAL_DMG_SHA\n    size: 789")
    expect(refreshed).toContain("path: AX-Code-7.3.0-mac-arm64.zip\nsha512: ZIP_SHA")
    expect(refreshed).not.toContain("OLD_DMG_SHA")
  })

  test("updates the canonical sha512 when the artifact is the canonical path", () => {
    const metadata = sampleMetadata
      .replace("path: AX-Code-7.3.0-mac-arm64.zip", "path: AX-Code-7.3.0-mac-arm64.dmg")
      .replace(/^sha512: ZIP_SHA$/m, "sha512: OLD_DMG_SHA")
    const refreshed = refreshMacUpdateMetadataText(metadata, {
      name: "AX-Code-7.3.0-mac-arm64.dmg",
      sha512: "FINAL_DMG_SHA",
      size: 789,
    })

    expect(refreshed).toContain("path: AX-Code-7.3.0-mac-arm64.dmg\nsha512: FINAL_DMG_SHA")
  })

  test("regenerates the blockmap and metadata from the final artifact bytes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-mac-update-metadata-"))
    const artifact = path.join(directory, "AX-Code-7.3.0-mac-arm64.dmg")
    const metadata = path.join(directory, "latest-mac.yml")

    try {
      const bytes = Buffer.from("final signed and stapled dmg fixture")
      await fs.writeFile(artifact, bytes)
      await fs.writeFile(metadata, sampleMetadata)

      const refreshed = await refreshMacUpdateArtifacts(artifact, metadata)
      const expectedSha512 = createHash("sha512").update(bytes).digest("base64")
      const metadataText = await fs.readFile(metadata, "utf8")
      const blockmap = await fs.stat(refreshed.blockmapPath)

      expect(refreshed.artifact).toEqual({
        name: path.basename(artifact),
        sha512: expectedSha512,
        size: bytes.length,
      })
      expect(metadataText).toContain(`    sha512: ${expectedSha512}\n    size: ${bytes.length}`)
      expect(blockmap.size).toBeGreaterThan(0)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test("fails closed when the metadata does not list the artifact", () => {
    expect(() =>
      refreshMacUpdateMetadataText(sampleMetadata, {
        name: "missing.dmg",
        sha512: "SHA",
        size: 1,
      }),
    ).toThrow(/does not list missing\.dmg/)
  })
})
