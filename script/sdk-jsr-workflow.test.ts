import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/sdk-jsr.yml"), "utf8")

describe("SDK JSR release workflow", () => {
  test("publishes only version-matched SDK tags through OIDC", () => {
    expect(workflow).toContain('      - "sdk-v*"')
    expect(workflow).toContain("format('refs/tags/{0}', inputs.tag)")
    expect(workflow).toContain('EXPECTED_TAG="sdk-v${SDK_VERSION}"')
    expect(workflow).toContain("id-token: write")
    expect(workflow).toContain("run publish:jsr -- --provenance")
  })

  test("gates publication on regeneration, tests, and a JSR dry-run", () => {
    expect(workflow).toContain("run build")
    expect(workflow).toContain("git diff --exit-code")
    expect(workflow).toContain("run typecheck")
    expect(workflow).toContain("run test")
    expect(workflow).toContain("run check:jsr")
  })

  test("does not configure registry tokens or npm publication", () => {
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|JSR_TOKEN/)
    expect(workflow).not.toMatch(/npm (?:pack|publish)/)
  })
})
