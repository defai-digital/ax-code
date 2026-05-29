import { createHash } from "node:crypto"
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import type { DesktopReleaseDiagnostics } from "../src/packaging/release-diagnostics"
import { checkDesktopUpdate, downloadDesktopUpdate, openDownloadedDesktopUpdate } from "../src/update/check"

describe("desktop update check", () => {
  test("stays disabled until the installed release is signed, notarized, and update-backed", async () => {
    const result = await checkDesktopUpdate({
      status: "manifest-found",
      updatePolicy: "disabled-until-release-pipeline",
      productName: "AX Code",
      version: "1.2.3",
      packageTarget: "mac",
      signed: false,
      notarized: false,
      updaterConfigured: false,
      gates: {},
    })

    expect(result).toMatchObject({
      status: "disabled",
      currentVersion: "1.2.3",
    })
  })

  test("stays disabled when the installed manifest is not an AX Code mac release", async () => {
    const result = await checkDesktopUpdate({
      ...releaseWithConfiguredFeed(),
      productName: "Other App",
      packageTarget: "windows",
    })

    expect(result).toMatchObject({
      status: "disabled",
      reason: "Update checks require an installed AX Code mac release manifest.",
    })
  })

  test("reports an available update from a valid feed", async () => {
    const requested: string[] = []
    const result = await checkDesktopUpdate(
      {
        ...releaseWithConfiguredFeed(),
      },
      {
        platform: "darwin",
        fetch: (async (url: string | URL | Request) => {
          requested.push(url.toString())
          return new Response(
            JSON.stringify({
              productName: "AX Code",
              version: "1.2.4",
              platform: "darwin",
              artifactName: "AX Code.app.zip",
              artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
              sha256: "b".repeat(64),
              sizeBytes: 456,
            }),
          )
        }) as typeof fetch,
      },
    )

    expect(requested).toEqual(["https://updates.example.test/ax-code/ax-code-update.json"])
    expect(result).toMatchObject({
      status: "available",
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
      sha256: "b".repeat(64),
      sizeBytes: 456,
    })
  })

  test("uses the installed release manifest feed name instead of a hard-coded update JSON", async () => {
    const requested: string[] = []
    const result = await checkDesktopUpdate(
      {
        ...releaseWithConfiguredFeed(),
        updateFeed: {
          ...releaseWithConfiguredFeed().updateFeed!,
          manifestName: "ax-code-update-darwin.json",
          manifestPath: "/ci/work/packages/desktop/dist/mac/ax-code-update-darwin.json",
        },
      },
      {
        platform: "darwin",
        fetch: (async (url: string | URL | Request) => {
          requested.push(url.toString())
          return new Response(
            JSON.stringify({
              productName: "AX Code",
              version: "1.2.4",
              platform: "darwin",
              artifactName: "AX-Code-1.2.4-mac.zip",
              artifactUrl: "https://updates.example.test/ax-code/AX-Code-1.2.4-mac.zip",
              sha256: "b".repeat(64),
              sizeBytes: 456,
            }),
          )
        }) as typeof fetch,
      },
    )

    expect(requested).toEqual(["https://updates.example.test/ax-code/ax-code-update-darwin.json"])
    expect(result).toMatchObject({
      status: "available",
      latestVersion: "1.2.4",
      artifactUrl: "https://updates.example.test/ax-code/AX-Code-1.2.4-mac.zip",
    })
  })

  test("times out stalled update feed requests", async () => {
    const result = await checkDesktopUpdate(releaseWithConfiguredFeed(), {
      platform: "darwin",
      requestTimeoutMs: 1,
      fetch: stalledFetch,
    })

    expect(result).toMatchObject({
      status: "error",
      reason: "Desktop update request timed out after 1ms.",
    })
  })

  test("stays disabled when installed release gate statuses have not passed", async () => {
    const result = await checkDesktopUpdate(
      {
        ...releaseWithConfiguredFeed(),
        gates: {
          ...passedReleaseGates(),
          notarization: { configured: true, status: "blocked", reason: "notary failed" },
        },
      },
      {
        platform: "darwin",
        fetch: (async () => {
          throw new Error("should not fetch updates without passed release gates")
        }) as unknown as typeof fetch,
      },
    )

    expect(result).toMatchObject({
      status: "disabled",
      reason: "Update checks are disabled until signing, notarization, and updater gates have passed.",
    })
  })

  test("rejects feeds that point at non-https artifacts", async () => {
    const result = await checkDesktopUpdate(
      {
        ...releaseWithConfiguredFeed(),
      },
      {
        platform: "darwin",
        fetch: (async () =>
          new Response(
            JSON.stringify({
              productName: "AX Code",
              version: "1.2.4",
              platform: "darwin",
              artifactUrl: "http://updates.example.test/AX Code.app.zip",
              sha256: "b".repeat(64),
              sizeBytes: 456,
            }),
          )) as unknown as typeof fetch,
      },
    )

    expect(result).toMatchObject({
      status: "error",
      reason: "Update artifact URL must use HTTPS.",
    })
  })

  test("rejects feeds that point outside the configured update feed URL", async () => {
    const result = await checkDesktopUpdate(releaseWithConfiguredFeed(), {
      platform: "darwin",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            productName: "AX Code",
            version: "1.2.4",
            platform: "darwin",
            artifactUrl: "https://updates.example.test/other/AX%20Code.app.zip",
            sha256: "b".repeat(64),
            sizeBytes: 456,
          }),
        )) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      status: "error",
      reason: "Update artifact URL must stay under the configured update feed URL.",
    })
  })

  test("rejects feeds that omit the artifact name", async () => {
    const result = await checkDesktopUpdate(releaseWithConfiguredFeed(), {
      platform: "darwin",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            productName: "AX Code",
            version: "1.2.4",
            platform: "darwin",
            artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
            sha256: "b".repeat(64),
            sizeBytes: 456,
          }),
        )) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      status: "error",
      reason: "Update feed is missing an artifact name.",
    })
  })

  test("rejects feeds whose artifact name does not match the artifact URL", async () => {
    const result = await checkDesktopUpdate(releaseWithConfiguredFeed(), {
      platform: "darwin",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            productName: "AX Code",
            version: "1.2.4",
            platform: "darwin",
            artifactName: "Other.app.zip",
            artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
            sha256: "b".repeat(64),
            sizeBytes: 456,
          }),
        )) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      status: "error",
      reason: "Update feed artifact name does not match the artifact URL.",
    })
  })

  test("downloads an available update only after size and SHA-256 verification", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-test-"))
    const artifactBytes = new TextEncoder().encode("signed, notarized update")
    const sha256 = createHash("sha256").update(artifactBytes).digest("hex")
    const requested: string[] = []
    try {
      const result = await downloadDesktopUpdate(releaseWithConfiguredFeed(), {
        platform: "darwin",
        updateDirectory,
        fetch: (async (url: string | URL | Request) => {
          requested.push(url.toString())
          if (url.toString().endsWith("ax-code-update.json")) {
            return new Response(
              JSON.stringify({
                productName: "AX Code",
                version: "1.2.4",
                platform: "darwin",
                artifactName: "AX Code.app.zip",
                artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
                sha256,
                sizeBytes: artifactBytes.byteLength,
              }),
            )
          }
          return new Response(artifactBytes)
        }) as unknown as typeof fetch,
      })

      expect(requested).toEqual([
        "https://updates.example.test/ax-code/ax-code-update.json",
        "https://updates.example.test/ax-code/AX%20Code.app.zip",
      ])
      expect(result).toMatchObject({
        status: "downloaded",
        latestVersion: "1.2.4",
        artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
        sha256,
        sizeBytes: artifactBytes.byteLength,
      })
      expect(result.artifactPath).toContain(updateDirectory)
      expect(await readFile(result.artifactPath!)).toEqual(Buffer.from(artifactBytes))
    } finally {
      await rm(updateDirectory, { force: true, recursive: true })
    }
  })

  test("does not follow an existing artifact symlink while saving a verified update", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-test-"))
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-outside-"))
    const artifactPath = path.join(updateDirectory, "1.2.4-AX-Code.app.zip")
    const outsidePath = path.join(outsideDirectory, "outside.txt")
    const artifactBytes = new TextEncoder().encode("signed, notarized update")
    const sha256 = createHash("sha256").update(artifactBytes).digest("hex")
    try {
      await writeFile(outsidePath, "do not overwrite")
      await symlink(outsidePath, artifactPath)

      const result = await downloadDesktopUpdate(releaseWithConfiguredFeed(), {
        platform: "darwin",
        updateDirectory,
        fetch: (async (url: string | URL | Request) => {
          if (url.toString().endsWith("ax-code-update.json")) {
            return new Response(
              JSON.stringify({
                productName: "AX Code",
                version: "1.2.4",
                platform: "darwin",
                artifactName: "AX-Code.app.zip",
                artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
                sha256,
                sizeBytes: artifactBytes.byteLength,
              }),
            )
          }
          return new Response(artifactBytes)
        }) as unknown as typeof fetch,
      })

      expect(result).toMatchObject({
        status: "downloaded",
        artifactPath,
        sha256,
        sizeBytes: artifactBytes.byteLength,
      })
      expect((await lstat(artifactPath)).isSymbolicLink()).toBe(false)
      expect(await readFile(artifactPath)).toEqual(Buffer.from(artifactBytes))
      expect(await readFile(outsidePath, "utf8")).toBe("do not overwrite")
    } finally {
      await rm(updateDirectory, { force: true, recursive: true })
      await rm(outsideDirectory, { force: true, recursive: true })
    }
  })

  test("rejects a symlinked update download directory", async () => {
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-parent-"))
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-outside-"))
    const updateDirectory = path.join(parentDirectory, "updates")
    const artifactBytes = new TextEncoder().encode("signed, notarized update")
    const sha256 = createHash("sha256").update(artifactBytes).digest("hex")
    try {
      await symlink(outsideDirectory, updateDirectory, "dir")

      const result = await downloadDesktopUpdate(releaseWithConfiguredFeed(), {
        platform: "darwin",
        updateDirectory,
        fetch: (async (url: string | URL | Request) => {
          if (url.toString().endsWith("ax-code-update.json")) {
            return new Response(
              JSON.stringify({
                productName: "AX Code",
                version: "1.2.4",
                platform: "darwin",
                artifactName: "AX-Code.app.zip",
                artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
                sha256,
                sizeBytes: artifactBytes.byteLength,
              }),
            )
          }
          return new Response(artifactBytes)
        }) as unknown as typeof fetch,
      })

      expect(result).toMatchObject({
        status: "error",
        reason: "Update download directory must not be a symbolic link.",
      })
    } finally {
      await rm(parentDirectory, { force: true, recursive: true })
      await rm(outsideDirectory, { force: true, recursive: true })
    }
  })

  test("does not write an update artifact when verification fails", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-test-"))
    try {
      const result = await downloadDesktopUpdate(releaseWithConfiguredFeed(), {
        platform: "darwin",
        updateDirectory,
        fetch: (async (url: string | URL | Request) => {
          if (url.toString().endsWith("ax-code-update.json")) {
            return new Response(
              JSON.stringify({
                productName: "AX Code",
                version: "1.2.4",
                platform: "darwin",
                artifactName: "AX Code.app.zip",
                artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
                sha256: "c".repeat(64),
                sizeBytes: 3,
              }),
            )
          }
          return new Response(new TextEncoder().encode("changed"))
        }) as unknown as typeof fetch,
      })

      expect(result).toMatchObject({
        status: "error",
        reason: "Update artifact size mismatch: expected 3, received 7.",
      })
    } finally {
      await rm(updateDirectory, { force: true, recursive: true })
    }
  })

  test("times out stalled update artifact downloads", async () => {
    const artifactBytes = new TextEncoder().encode("signed, notarized update")
    const sha256 = createHash("sha256").update(artifactBytes).digest("hex")
    const result = await downloadDesktopUpdate(releaseWithConfiguredFeed(), {
      platform: "darwin",
      requestTimeoutMs: 1,
      fetch: (async (url: string | URL | Request) => {
        if (url.toString().endsWith("ax-code-update.json")) {
          return new Response(
            JSON.stringify({
              productName: "AX Code",
              version: "1.2.4",
              platform: "darwin",
              artifactName: "AX-Code.app.zip",
              artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
              sha256,
              sizeBytes: artifactBytes.byteLength,
            }),
          )
        }
        return stalledFetch(url)
      }) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      status: "error",
      reason: "Desktop update request timed out after 1ms.",
    })
  })

  test("opens a downloaded update only from the controlled download directory", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-test-"))
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-outside-"))
    const artifactPath = path.join(updateDirectory, "1.2.4-AX-Code.app.zip")
    const outsidePath = path.join(outsideDirectory, "AX-Code.app.zip")
    const artifactBytes = new TextEncoder().encode("verified update")
    const sha256 = createHash("sha256").update(artifactBytes).digest("hex")
    const opened: string[] = []
    try {
      await writeFile(artifactPath, artifactBytes)
      await writeFile(outsidePath, "outside update")

      const result = await openDownloadedDesktopUpdate(
        releaseWithConfiguredFeed(),
        { artifactPath },
        {
          platform: "darwin",
          updateDirectory,
          fetch: updateFeedFetch({
            artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
            sha256,
            sizeBytes: artifactBytes.byteLength,
          }),
          async openArtifact(path) {
            opened.push(path)
          },
        },
      )

      expect(result.status).toBe("opened")
      expect(result.artifactPath).toContain("1.2.4-AX-Code.app.zip")
      expect(result).toMatchObject({ latestVersion: "1.2.4", sha256, sizeBytes: artifactBytes.byteLength })
      expect(opened).toEqual([result.artifactPath!])

      const outsideResult = await openDownloadedDesktopUpdate(
        releaseWithConfiguredFeed(),
        { artifactPath: outsidePath },
        {
          updateDirectory,
          fetch: updateFeedFetch({
            artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
            sha256,
            sizeBytes: artifactBytes.byteLength,
          }),
          async openArtifact() {
            throw new Error("should not open outside artifact")
          },
        },
      )

      expect(outsideResult).toMatchObject({
        status: "error",
        reason: "Downloaded update artifact must stay inside the controlled update download directory.",
      })
    } finally {
      await rm(updateDirectory, { force: true, recursive: true })
      await rm(outsideDirectory, { force: true, recursive: true })
    }
  })

  test("rejects a symlinked update directory while opening a downloaded update", async () => {
    const parentDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-parent-"))
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-outside-"))
    const updateDirectory = path.join(parentDirectory, "updates")
    const artifactPath = path.join(updateDirectory, "1.2.4-AX-Code.app.zip")
    const realArtifactPath = path.join(outsideDirectory, "1.2.4-AX-Code.app.zip")
    const artifactBytes = new TextEncoder().encode("verified update")
    const sha256 = createHash("sha256").update(artifactBytes).digest("hex")
    try {
      await writeFile(realArtifactPath, artifactBytes)
      await symlink(outsideDirectory, updateDirectory, "dir")

      const result = await openDownloadedDesktopUpdate(
        releaseWithConfiguredFeed(),
        { artifactPath },
        {
          platform: "darwin",
          updateDirectory,
          fetch: updateFeedFetch({
            artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
            sha256,
            sizeBytes: artifactBytes.byteLength,
          }),
          async openArtifact() {
            throw new Error("should not open through a symlinked update directory")
          },
        },
      )

      expect(result).toMatchObject({
        status: "error",
        reason: "Update download directory must not be a symbolic link.",
      })
    } finally {
      await rm(parentDirectory, { force: true, recursive: true })
      await rm(outsideDirectory, { force: true, recursive: true })
    }
  })

  test("re-verifies downloaded update bytes before opening", async () => {
    const updateDirectory = await mkdtemp(path.join(tmpdir(), "ax-code-update-test-"))
    const artifactPath = path.join(updateDirectory, "1.2.4-AX-Code.app.zip")
    try {
      await writeFile(artifactPath, "tampered update")

      const result = await openDownloadedDesktopUpdate(
        releaseWithConfiguredFeed(),
        { artifactPath },
        {
          platform: "darwin",
          updateDirectory,
          fetch: updateFeedFetch({
            artifactUrl: "https://updates.example.test/ax-code/AX-Code.app.zip",
            sha256: "d".repeat(64),
            sizeBytes: "tampered update".length,
          }),
          async openArtifact() {
            throw new Error("should not open tampered artifact")
          },
        },
      )

      expect(result).toMatchObject({
        status: "error",
        reason: "Downloaded update artifact SHA-256 verification failed.",
      })
    } finally {
      await rm(updateDirectory, { force: true, recursive: true })
    }
  })

  test("does not open downloaded updates until release gates are enabled", async () => {
    const result = await openDownloadedDesktopUpdate(
      {
        status: "manifest-found",
        updatePolicy: "disabled-until-release-pipeline",
        productName: "AX Code",
        version: "1.2.3",
        packageTarget: "mac",
        signed: false,
        notarized: false,
        updaterConfigured: false,
        gates: {},
      },
      { artifactPath: "/tmp/ax-code-desktop-updates/app.zip" },
      {
        async openArtifact() {
          throw new Error("should not open without release gates")
        },
      },
    )

    expect(result).toMatchObject({
      status: "disabled",
      reason: "Update apply is disabled until signed, notarized, update-feed-backed artifacts are installed.",
    })
  })

  test("does not open downloaded updates for a non-mac installed release manifest", async () => {
    const result = await openDownloadedDesktopUpdate(
      {
        ...releaseWithConfiguredFeed(),
        productName: "Other App",
        packageTarget: "windows",
      },
      { artifactPath: "/tmp/ax-code-desktop-updates/app.zip" },
      {
        async openArtifact() {
          throw new Error("should not open without a trusted installed release manifest")
        },
      },
    )

    expect(result).toMatchObject({
      status: "disabled",
      reason: "Applying updates requires an installed AX Code mac release manifest.",
    })
  })
})

function releaseWithConfiguredFeed(): DesktopReleaseDiagnostics {
  return {
    status: "manifest-found",
    updatePolicy: "disabled-until-release-pipeline",
    productName: "AX Code",
    version: "1.2.3",
    packageTarget: "mac",
    signed: true,
    notarized: true,
    updaterConfigured: true,
    updateFeed: {
      url: "https://updates.example.test/ax-code/",
      manifestName: "ax-code-update.json",
      manifestPath: "/tmp/ax-code-update.json",
      artifactPath: "/tmp/AX Code.app.zip",
      artifactName: "AX Code.app.zip",
      artifactUrl: "https://updates.example.test/ax-code/AX%20Code.app.zip",
      sha256: "a".repeat(64),
      sizeBytes: 123,
    },
    gates: passedReleaseGates(),
  }
}

function passedReleaseGates() {
  return {
    signing: { configured: true, status: "passed" },
    notarization: { configured: true, status: "passed" },
    updater: { configured: true, status: "passed" },
  }
}

function updateFeedFetch(input: { artifactUrl: string; sha256: string; sizeBytes: number }) {
  return (async () =>
    new Response(
      JSON.stringify({
        productName: "AX Code",
        version: "1.2.4",
        platform: "darwin",
        artifactName: decodeURIComponent(path.basename(new URL(input.artifactUrl).pathname)),
        artifactUrl: input.artifactUrl,
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
      }),
    )) as unknown as typeof fetch
}

const stalledFetch = ((url: string | URL | Request, init?: RequestInit) => {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (signal?.aborted) {
      reject(signal.reason ?? new Error(`aborted ${url.toString()}`))
      return
    }
    signal?.addEventListener("abort", () => reject(signal.reason ?? new Error(`aborted ${url.toString()}`)), {
      once: true,
    })
  })
}) as typeof fetch
