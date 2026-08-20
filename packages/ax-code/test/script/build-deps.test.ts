import { describe, expect, test } from "vitest"
import { collectPackageRuntimeDependencies, resolveInstalledPackagePath } from "../../script/build-deps"

describe("script.build-deps", () => {
  test("resolves scoped package install paths inside node_modules", () => {
    expect(resolveInstalledPackagePath("/repo/node_modules", "@ax-code/tui")).toBe("/repo/node_modules/@ax-code/tui")
    expect(resolveInstalledPackagePath("/repo/node_modules", "semver")).toBe("/repo/node_modules/semver")
  })

  test("collects installable runtime dependencies from vendored workspace package manifests", () => {
    expect(
      collectPackageRuntimeDependencies([
        {
          dependencies: {
            "@ax-code/tui": "workspace:*",
            entities: "7.0.1",
            "s-js": "^0.4.9",
          },
          peerDependencies: {
            "solid-js": "1.9.12",
          },
        },
        {
          dependencies: {
            "@ax-code/tui/solid": "workspace:*",
            "cli-spinners": "^3.3.0",
            "local-dev-only": "link:../local-dev-only",
            "catalog-only": "catalog:",
          },
        },
      ]),
    ).toEqual({
      "cli-spinners": "^3.3.0",
      entities: "7.0.1",
      "s-js": "^0.4.9",
      "solid-js": "1.9.12",
    })
  })
})
