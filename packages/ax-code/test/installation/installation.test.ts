import { describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function withTestDependencies<T>(
  options: {
    fetch?: (url: string, init?: RequestInit) => Promise<Response> | Response
    run?: (
      cmd: string[],
      opts?: { cwd?: string; env?: Record<string, string>; input?: Uint8Array },
    ) => Promise<{ code: number; stdout: string; stderr: string }> | { code: number; stdout: string; stderr: string }
  },
  fn: () => Promise<T>,
) {
  return Installation.withDependencies(
    {
      fetch: ((url, init) => Promise.resolve(options.fetch?.(String(url), init) ?? jsonResponse({}))) as typeof fetch,
      run: async (cmd, opts) => {
        const result = await options.run?.(cmd, opts)
        return result ?? { code: 0, stdout: "", stderr: "" }
      },
    },
    fn,
  )
}

describe("installation", () => {
  describe("release type", () => {
    test("classifies semver changes", () => {
      expect(Installation.getReleaseType("1.2.3", "1.2.4")).toBe("patch")
      expect(Installation.getReleaseType("1.2.3", "1.3.0")).toBe("minor")
      expect(Installation.getReleaseType("1.2.3", "2.0.0")).toBe("major")
    })

    test("returns unknown when versions cannot be compared", () => {
      expect(Installation.compareVersions("1.2.3", "unknown")).toBeUndefined()
      expect(Installation.getReleaseType("1.2.3", "unknown")).toBe("unknown")
    })
  })

  describe("latest", () => {
    test("reads release version from GitHub releases", async () => {
      const result = await withTestDependencies(
        {
          fetch: () => jsonResponse({ tag_name: "v1.2.3" }),
        },
        () => Installation.latest("unknown"),
      )

      expect(result).toBe("1.2.3")
    })

    test("strips v prefix from GitHub release tag", async () => {
      const result = await withTestDependencies(
        {
          fetch: () => jsonResponse({ tag_name: "v4.0.0-beta.1" }),
        },
        () => Installation.latest("curl"),
      )

      expect(result).toBe("4.0.0-beta.1")
    })

    test("reads brew formulae API versions", async () => {
      const result = await withTestDependencies(
        {
          fetch: () => jsonResponse({ versions: { stable: "2.0.0" } }),
          run: (cmd) => {
            if (cmd[0] === "brew" && cmd[1] === "list" && cmd[2] === "--formula" && cmd[3] === "ax-code") {
              return { code: 0, stdout: "ax-code\n", stderr: "" }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.latest("brew"),
      )

      expect(result).toBe("2.0.0")
    })

    test("reads brew tap info JSON via CLI", async () => {
      const brewInfoJson = JSON.stringify({
        formulae: [{ versions: { stable: "2.1.0" } }],
      })

      const result = await withTestDependencies(
        {
          run: (cmd) => {
            if (cmd[0] === "brew" && cmd.includes("defai-digital/tap/ax-code") && cmd.includes("--formula")) {
              return { code: 0, stdout: "ax-code", stderr: "" }
            }
            if (cmd[0] === "brew" && cmd.includes("--json=v2")) return { code: 0, stdout: brewInfoJson, stderr: "" }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.latest("brew"),
      )

      expect(result).toBe("2.1.0")
    })
  })

  describe("method", () => {
    test("ignores legacy npm global installs as an unsupported channel", async () => {
      const result = await withTestDependencies(
        {
          run: (cmd) => {
            if (cmd[0] === "npm" && cmd.includes("--depth=0")) {
              return { code: 0, stdout: "└── @defai.digital/ax-code@3.2.0\n", stderr: "" }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.method(),
      )

      expect(result).toBe("unknown")
    })

    test("detects Homebrew installs", async () => {
      const result = await withTestDependencies(
        {
          run: (cmd) => {
            if (cmd[0] === "brew" && cmd.includes("--formula")) return { code: 0, stdout: "ax-code\n", stderr: "" }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.method(),
      )

      expect(result).toBe("brew")
    })
  })

  describe("upgrade", () => {
    test("refreshes the detected Homebrew tap before upgrading", async () => {
      const calls: Array<{ cmd: string[]; cwd?: string }> = []

      await withTestDependencies(
        {
          run: (cmd, opts) => {
            calls.push({ cmd, cwd: opts?.cwd })
            if (cmd[0] === "brew" && cmd.includes("--formula")) return { code: 0, stdout: "ax-code\n", stderr: "" }
            if (cmd[0] === "brew" && cmd.includes("--repo")) {
              return { code: 0, stdout: "/tmp/homebrew-ax-code\n", stderr: "" }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("brew", "5.3.0"),
      )

      expect(calls).toContainEqual({ cmd: ["brew", "tap", "defai-digital/ax-code"], cwd: undefined })
      expect(calls).toContainEqual({ cmd: ["git", "pull", "--ff-only"], cwd: "/tmp/homebrew-ax-code" })
      expect(calls).toContainEqual({ cmd: ["brew", "upgrade", "defai-digital/ax-code/ax-code"], cwd: undefined })
    })
  })
})
