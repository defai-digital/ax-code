import { describe, expect, test } from "bun:test"
import { collectBinaryPublishTargets } from "../../script/publish-plan"

describe("script.publish-plan", () => {
  test("publishes scoped binary packages from their legacy dist directories", () => {
    expect(
      collectBinaryPublishTargets(
        [
          {
            manifestPath: "ax-code-linux-x64/package.json",
            packageName: "@defai.digital/ax-code-linux-x64",
            version: "2.26.8",
          },
        ],
        "ax-code",
      ),
    ).toEqual([
      {
        packageName: "@defai.digital/ax-code-linux-x64",
        version: "2.26.8",
        distDir: "ax-code-linux-x64",
      },
    ])
  })

  test("ignores unrelated manifests and normalizes Windows-style paths", () => {
    expect(
      collectBinaryPublishTargets(
        [
          {
            manifestPath: "ax-code-windows-x64\\package.json",
            packageName: "@defai.digital/ax-code-windows-x64",
            version: "2.26.8",
          },
          {
            manifestPath: "ax-code/package.json",
            packageName: "@defai.digital/ax-code",
            version: "2.26.8",
          },
          {
            manifestPath: "broken/package.json",
            packageName: 123,
            version: "2.26.8",
          },
        ],
        "ax-code",
      ),
    ).toEqual([
      {
        packageName: "@defai.digital/ax-code-windows-x64",
        version: "2.26.8",
        distDir: "ax-code-windows-x64",
      },
    ])
  })
})
