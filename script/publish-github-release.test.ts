import { describe, expect, test, vi } from "vitest"
import childProcess from "child_process"
import fs from "fs"
import path from "path"
import {
  defaultInstallChannel,
  defaultTag,
  expectedReleaseArchives,
  expectedReleaseInstallerAssets,
  expectedReleaseInstallerSignatures,
  expectedReleaseMetadataAssets,
  expectedReleaseSignatures,
  isPrerelease,
  missingReleaseAssets,
  normalizeVersion,
  parsePublishGithubReleaseArgs,
  publishPlan,
  selectWorkflowRunID,
  trackedInternalPrivacyIssue,
  workflowRunListArgs,
  watchReleaseWorkflow,
} from "./publish-github-release"

describe("publish-github-release helpers", () => {
  test("does not watch a release when the remote tag commit is missing", () => {
    const options = parsePublishGithubReleaseArgs(["--version", "5.10.1", "--existing-tag"])
    const spawn = vi.spyOn(childProcess, "spawnSync").mockReturnValue({
      pid: 1,
      output: [null, "", ""],
      stdout: "",
      stderr: "",
      status: 0,
      signal: null,
    })
    try {
      expect(() => watchReleaseWorkflow(options)).toThrow("Cannot resolve the remote commit")
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(spawn.mock.calls[0][0]).toBe("git")
    } finally {
      spawn.mockRestore()
    }
  })

  test.each(["annotated", "lightweight"])(
    "watches the remote %s tag commit instead of an older cancelled candidate",
    (kind) => {
      const commit = "b".repeat(40)
      const options = parsePublishGithubReleaseArgs(["--version", "5.10.1", "--existing-tag"])
      const watched: string[] = []
      const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation((command, args) => {
        const argv = args as string[]
        let stdout = ""
        if (command === "git" && argv[0] === "ls-remote") {
          stdout =
            kind === "annotated"
              ? `${"a".repeat(40)}\trefs/tags/v5.10.1\n${commit}\trefs/tags/v5.10.1^{}\n`
              : `${commit}\trefs/tags/v5.10.1\n`
        } else if (command === "gh" && argv[1] === "list") {
          // GitHub can still return the older cancelled run while the new
          // candidate is being indexed unless its commit is part of the query.
          stdout = argv[argv.indexOf("--commit") + 1] === commit ? "200\n" : "100\n"
        } else if (command === "gh" && argv[1] === "watch") {
          watched.push(argv[2])
        } else throw new Error(`Unexpected command: ${command} ${argv.join(" ")}`)
        return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status: 0, signal: null }
      })
      try {
        watchReleaseWorkflow(options)
        expect(watched).toEqual(["200"])
      } finally {
        spawn.mockRestore()
      }
    },
  )

  test("keeps the workflow as sole signer and independently verifies its assets", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "publish-github-release.ts"), "utf8")

    expect(source).toContain('run("minisign", ["-V"')
    expect(source).toContain("Downloaded ax-minisign.pub does not match")
    expect(source).not.toContain('["release", "upload"')
    expect(source).not.toContain("signReleaseAssetsCommand")
  })

  test("normalizes versions and tags", () => {
    expect(normalizeVersion("v5.10.1")).toBe("5.10.1")
    expect(normalizeVersion("5.10.1-beta.1")).toBe("5.10.1-beta.1")
    expect(defaultTag("5.10.1")).toBe("v5.10.1")
    expect(defaultTag("v5.10.1")).toBe("v5.10.1")
  })

  test("uses the install smoke channel that matches release type", () => {
    expect(isPrerelease("5.10.1")).toBe(false)
    expect(isPrerelease("5.10.1-beta.1")).toBe(true)
    expect(defaultInstallChannel("5.10.1")).toBe("all")
    expect(defaultInstallChannel("5.10.1-beta.1")).toBe("windows")
  })

  test("tracks required GitHub release archives and signatures", () => {
    expect(expectedReleaseArchives()).toEqual([
      "ax-code-darwin-arm64.zip",
      "ax-code-windows-x64.zip",
      "ax-code-windows-arm64.zip",
      "ax-code-linux-x64.tar.gz",
      "ax-code-linux-arm64.tar.gz",
    ])
    expect(expectedReleaseSignatures()).toEqual([
      "ax-code-darwin-arm64.zip.minisig",
      "ax-code-windows-x64.zip.minisig",
      "ax-code-windows-arm64.zip.minisig",
      "ax-code-linux-x64.tar.gz.minisig",
      "ax-code-linux-arm64.tar.gz.minisig",
    ])
    expect(expectedReleaseInstallerAssets()).toEqual(["install.ps1"])
    expect(expectedReleaseInstallerSignatures()).toEqual(["install.ps1.minisig"])
    expect(expectedReleaseMetadataAssets()).toEqual(["ax-minisign.pub"])
  })

  test("reports missing release assets", () => {
    expect(
      missingReleaseAssets([
        "ax-code-darwin-arm64.zip",
        "ax-code-windows-x64.zip",
        "ax-code-windows-arm64.zip",
        "ax-code-linux-x64.tar.gz",
        "ax-code-linux-arm64.tar.gz",
        "ax-code-darwin-arm64.zip.minisig",
        "install.ps1",
      ]),
    ).toEqual([
      "ax-code-windows-x64.zip.minisig",
      "ax-code-windows-arm64.zip.minisig",
      "ax-code-linux-x64.tar.gz.minisig",
      "ax-code-linux-arm64.tar.gz.minisig",
      "install.ps1.minisig",
      "ax-minisign.pub",
    ])
  })

  test("reports tracked internal files as a release privacy issue", () => {
    expect(trackedInternalPrivacyIssue([])).toBeUndefined()
    expect(trackedInternalPrivacyIssue([".internal/adr/ADR-058-ax-code-tui.md"])).toBe(
      ".internal files are tracked: .internal/adr/ADR-058-ax-code-tui.md. Remove them from git index before publishing.",
    )
    expect(
      trackedInternalPrivacyIssue([
        ".internal/prd/private.md",
        ".internal/adr/private.md",
        ".internal/bugs/private.md",
        ".internal/release/private.md",
        ".internal/reports/private.md",
        ".internal/archive/private.md",
      ]),
    ).toBe(
      ".internal files are tracked: .internal/prd/private.md, .internal/adr/private.md, .internal/bugs/private.md, .internal/release/private.md, .internal/reports/private.md, and 1 more. Remove them from git index before publishing.",
    )
  })

  test("parses publish options with safe defaults", () => {
    const options = parsePublishGithubReleaseArgs(
      ["--version", "v5.10.1", "--repo", "owner/repo", "--asset-dir", "/tmp/assets", "--existing-tag", "--skip-watch"],
      {},
      "/repo",
      "/home/ax",
    )

    expect(options.version).toBe("5.10.1")
    expect(options.tag).toBe("v5.10.1")
    expect(options.repo).toBe("owner/repo")
    expect(options.assetDir).toBe("/tmp/assets")
    expect(options.existingTag).toBe(true)
    expect(options.skipReleaseWatch).toBe(true)
  })

  test("accepts a pnpm-forwarded argument separator", () => {
    const options = parsePublishGithubReleaseArgs(["--", "--version", "v5.10.1"], {}, "/repo", "/home/ax")
    expect(options.version).toBe("5.10.1")
    expect(options.tag).toBe("v5.10.1")
  })

  test("filters release workflow discovery to the exact tag push", () => {
    expect(
      workflowRunListArgs("release.yml", "owner/repo", {
        branch: "v5.10.1",
        event: "push",
      }),
    ).toEqual([
      "run",
      "list",
      "--repo",
      "owner/repo",
      "--workflow",
      "release.yml",
      "--limit",
      "100",
      "--branch",
      "v5.10.1",
      "--event",
      "push",
      "--json",
      "databaseId",
      "--jq",
      ".[].databaseId",
    ])
  })

  test("selects only a workflow run created after dispatch", () => {
    const previous = new Set(["100", "99"])
    expect(selectWorkflowRunID(["100", "99"], previous)).toBeUndefined()
    expect(selectWorkflowRunID(["101", "100", "99"], previous)).toBe("101")
  })

  test("describes the publish plan", () => {
    const options = parsePublishGithubReleaseArgs(["--version", "5.10.1-beta.1"], {}, "/repo", "/home/ax")
    expect(publishPlan(options)).toEqual([
      "publish v5.10.1-beta.1 to defai-digital/ax-code",
      "create and push annotated release tag",
      "watch release.yml",
      "independently verify release signatures with docs/release/ax-minisign.pub",
      "dispatch install-matrix-smoke.yml channel=windows",
    ])
  })
})
