import { describe, expect, test } from "bun:test"
import { collectBuildDependencyPackages, resolveInstalledPackagePath } from "../../script/build-deps"

describe("script.build-deps", () => {
  test("collects only build-time target packages for OpenTUI and parcel watcher", () => {
    expect(
      collectBuildDependencyPackages(
        {
          "@opentui/core-darwin-arm64": "0.1.100",
          "@opentui/core-linux-x64": "0.1.100",
          "@opentui/core-win32-arm64": "0.1.100",
          "@opentui/core": "0.1.100",
          three: "0.177.0",
        },
        {
          "@parcel/watcher-darwin-arm64": "2.5.1",
          "@parcel/watcher-linux-x64-glibc": "2.5.1",
          "@parcel/watcher": "2.5.1",
          typescript: "5.8.2",
        },
        [
          { os: "darwin", arch: "arm64" },
          { os: "linux", arch: "x64" },
          { os: "linux", arch: "x64" },
        ],
        { os: "darwin", arch: "arm64" },
      ),
    ).toEqual([
      { name: "@opentui/core-linux-x64", version: "0.1.100" },
      { name: "@parcel/watcher-darwin-arm64", version: "2.5.1" },
      { name: "@parcel/watcher-linux-x64-glibc", version: "2.5.1" },
    ])
  })

  test("resolves scoped package install paths inside node_modules", () => {
    expect(resolveInstalledPackagePath("/repo/node_modules", "@opentui/core-linux-arm64")).toBe(
      "/repo/node_modules/@opentui/core-linux-arm64",
    )
    expect(resolveInstalledPackagePath("/repo/node_modules", "semver")).toBe("/repo/node_modules/semver")
  })
})
