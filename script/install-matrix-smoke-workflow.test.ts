import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(".github/workflows/install-matrix-smoke.yml", "utf8")

describe("install matrix smoke workflow", () => {
  test("pins bash installers to the release tag and retries transient downloads", () => {
    expect(workflow).not.toContain("api.github.com/repos/${{ github.repository }}/contents/install")
    expect(workflow).not.toContain("contents/install?ref=main")
    expect(
      workflow.match(
        /INSTALLER_URL="https:\/\/raw\.githubusercontent\.com\/\$\{\{ github\.repository \}\}\/v\$\{VERSION\}\/install"/g,
      ),
    ).toHaveLength(2)
    expect(workflow.match(/curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "\$INSTALLER_URL"/g)).toHaveLength(2)
  })
})
