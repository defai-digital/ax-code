import { expect, test } from "vitest"
import { spawnSync } from "node:child_process"

test.each(["-1", "01", "1.5", "1; exit 0", "1\nputs :injected"])(
  "rejects unsafe Homebrew revision %j before credential or network access",
  (revision) => {
    const result = spawnSync("bash", [".github/scripts/update-homebrew.sh"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        AX_CODE_RELEASE_TAG: "v7.25.3",
        AX_CODE_HOMEBREW_REVISION: revision,
      },
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("AX_CODE_HOMEBREW_REVISION must be a non-negative integer")
    expect(result.stdout).not.toContain("GH_TOKEN is required")
  },
)
