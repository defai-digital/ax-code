import { describe, expect, test } from "vitest"
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
    which?: (cmd: string) => string[]
    platform?: NodeJS.Platform
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
      which: (cmd) => options.which?.(cmd) ?? [],
      ...(options.platform ? { platform: options.platform } : {}),
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

    test("raises a recoverable error instead of crashing on empty brew info output", async () => {
      const promise = withTestDependencies(
        {
          run: (cmd) => {
            if (cmd[0] === "brew" && cmd.includes("defai-digital/tap/ax-code") && cmd.includes("--formula")) {
              return { code: 0, stdout: "ax-code", stderr: "" }
            }
            // Simulates a failed `brew info --json=v2` invocation that writes
            // nothing to stdout — this used to throw a raw
            // "Unexpected end of JSON input" SyntaxError.
            if (cmd[0] === "brew" && cmd.includes("--json=v2")) return { code: 1, stdout: "", stderr: "" }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.latest("brew"),
      )

      await expect(promise).rejects.toThrow(/Failed to parse .*brew info.*JSON \(empty output\)/)
    })

    test("raises a recoverable error instead of crashing on a malformed API response", async () => {
      const promise = withTestDependencies(
        {
          fetch: () => new Response("not json", { status: 200 }),
        },
        () => Installation.latest("unknown"),
      )

      await expect(promise).rejects.toThrow(/Failed to parse response from .* as JSON/)
    })
  })

  describe("verifyActiveLauncher", () => {
    test("flags a launcher missing from PATH entirely", async () => {
      // The post-upgrade state of issue #342: Homebrew skipped linking the
      // formula because a same-token cask was installed, cleanup removed the
      // previously linked keg, and no ax-code resolves anywhere on PATH.
      const result = await withTestDependencies({ which: () => [] }, () => Installation.verifyActiveLauncher("2.0.0"))

      expect(result).toEqual({ ok: false, launchers: [] })
    })

    test("is ok when the first PATH match reports the upgraded version", async () => {
      const result = await withTestDependencies(
        {
          which: () => ["/opt/homebrew/bin/ax-code"],
          run: (cmd) => {
            if (cmd[1] === "--version") return { code: 0, stdout: "2.0.0\n", stderr: "" }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.verifyActiveLauncher("2.0.0"),
      )

      expect(result.ok).toBe(true)
      expect(result.activePath).toBe("/opt/homebrew/bin/ax-code")
      expect(result.activeVersion).toBe("2.0.0")
    })

    test("flags a stale launcher earlier on PATH that shadows the upgrade", async () => {
      const result = await withTestDependencies(
        {
          which: () => ["/Users/devop/.local/bin/ax-code", "/opt/homebrew/bin/ax-code"],
          run: (cmd) => {
            if (cmd[0] === "/Users/devop/.local/bin/ax-code" && cmd[1] === "--version") {
              return { code: 0, stdout: "1.9.7\n", stderr: "" }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.verifyActiveLauncher("2.0.0"),
      )

      expect(result.ok).toBe(false)
      expect(result.activePath).toBe("/Users/devop/.local/bin/ax-code")
      expect(result.activeVersion).toBe("1.9.7")
      expect(result.launchers).toEqual(["/Users/devop/.local/bin/ax-code", "/opt/homebrew/bin/ax-code"])
    })

    test("formats actionable warnings for missing and shadowed launchers", () => {
      expect(Installation.launcherWarnings("2.0.0", { ok: false, launchers: [] })[0]).toMatch(
        /No `ax-code` launcher found on PATH/,
      )
      expect(
        Installation.launcherWarnings("2.0.0", {
          ok: false,
          launchers: ["/old/bin/ax-code", "/new/bin/ax-code"],
          activePath: "/old/bin/ax-code",
          activeVersion: "1.9.7",
        })[0],
      ).toMatch(/\/old\/bin\/ax-code \(v1\.9\.7\)/)
      expect(
        Installation.launcherWarnings("2.0.0", {
          ok: true,
          launchers: ["/new/bin/ax-code"],
          activePath: "/new/bin/ax-code",
          activeVersion: "2.0.0",
        }),
      ).toEqual([])
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
              return { code: 0, stdout: "/tmp/homebrew-tap\n", stderr: "" }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("brew", "5.3.0"),
      )

      expect(calls).toContainEqual({ cmd: ["brew", "tap", "defai-digital/tap"], cwd: undefined })
      expect(calls).toContainEqual({ cmd: ["git", "pull", "--ff-only"], cwd: "/tmp/homebrew-tap" })
      expect(calls).toContainEqual({ cmd: ["brew", "upgrade", "defai-digital/tap/ax-code"], cwd: undefined })
    })

    test("keeps product-specific tap installs upgradeable during migration", async () => {
      const calls: string[][] = []

      await withTestDependencies(
        {
          run: (cmd) => {
            calls.push(cmd)
            if (cmd[0] === "brew" && cmd[1] === "list" && cmd[3] === "defai-digital/ax-code/ax-code") {
              return { code: 0, stdout: "ax-code\n", stderr: "" }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("brew", "5.3.0"),
      )

      expect(calls).toContainEqual(["brew", "tap", "defai-digital/ax-code"])
      expect(calls).toContainEqual(["brew", "upgrade", "defai-digital/ax-code/ax-code"])
    })

    test("relinks the formula when brew skips the link because a same-token cask is installed", async () => {
      const calls: string[][] = []

      await withTestDependencies(
        {
          run: (cmd) => {
            calls.push(cmd)
            if (cmd[0] === "brew" && cmd.includes("--formula")) return { code: 0, stdout: "ax-code\n", stderr: "" }
            if (cmd[0] === "brew" && cmd[1] === "upgrade") {
              return {
                code: 0,
                stdout: "==> ax-code cask is installed, skipping link.\n",
                stderr: "",
              }
            }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("brew", "5.3.0"),
      )

      expect(calls).toContainEqual(["brew", "link", "defai-digital/tap/ax-code"])
    })

    test("does not relink when brew linked the formula normally", async () => {
      const calls: string[][] = []

      await withTestDependencies(
        {
          run: (cmd) => {
            calls.push(cmd)
            if (cmd[0] === "brew" && cmd.includes("--formula")) return { code: 0, stdout: "ax-code\n", stderr: "" }
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("brew", "5.3.0"),
      )

      expect(calls.some((cmd) => cmd[0] === "brew" && cmd[1] === "link")).toBe(false)
    })

    test("pipes the bash installer to bash with VERSION on non-Windows", async () => {
      const script = "#!/bin/bash\necho install\n"
      const calls: Array<{ cmd: string[]; env?: Record<string, string>; input?: Uint8Array }> = []

      await withTestDependencies(
        {
          platform: "linux",
          fetch: (url) => {
            if (url.endsWith("/install")) return new Response(script, { status: 200 })
            // Missing .sha256 sidecar warns and proceeds.
            return new Response("not found", { status: 404 })
          },
          run: (cmd, opts) => {
            calls.push({ cmd, env: opts?.env, input: opts?.input })
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("curl", "5.3.0"),
      )

      const bash = calls.find((c) => c.cmd[0] === "bash")
      expect(bash).toBeDefined()
      expect(bash?.env?.VERSION).toBe("5.3.0")
      expect(new TextDecoder().decode(bash?.input)).toBe(script)
    })

    test("runs the PowerShell installer via powershell.exe on Windows", async () => {
      const script = "param([string]$Version)\nWrite-Host $Version\n"
      const calls: string[][] = []

      await withTestDependencies(
        {
          platform: "win32",
          fetch: (url) => {
            if (url.endsWith("/install.ps1")) return new Response(script, { status: 200 })
            return new Response("not found", { status: 404 })
          },
          run: (cmd) => {
            calls.push(cmd)
            return { code: 0, stdout: "", stderr: "" }
          },
        },
        () => Installation.upgrade("curl", "5.3.0"),
      )

      const ps = calls.find((cmd) => cmd[0] === "powershell.exe")
      expect(ps).toBeDefined()
      expect(ps).toContain("-ExecutionPolicy")
      expect(ps).toContain("Bypass")
      expect(ps).toContain("-File")
      expect(ps?.slice(-2)).toEqual(["-Version", "5.3.0"])
      expect(calls.some((cmd) => cmd[0] === "bash")).toBe(false)
    })

    test("hard-fails when the installer script sha256 sidecar mismatches", async () => {
      const promise = withTestDependencies(
        {
          platform: "linux",
          fetch: (url) => {
            if (url.endsWith("/install")) return new Response("#!/bin/bash\n", { status: 200 })
            if (url.endsWith("/install.sha256")) return new Response(`${"0".repeat(64)}  install\n`, { status: 200 })
            return new Response("not found", { status: 404 })
          },
        },
        () => Installation.upgrade("curl", "5.3.0"),
      )

      await expect(promise).rejects.toThrow(/integrity check failed/)
    })

    test("hard-fails when a present installer sidecar is malformed", async () => {
      const promise = withTestDependencies(
        {
          platform: "linux",
          fetch: (url) => {
            if (url.endsWith("/install")) return new Response("#!/bin/bash\n", { status: 200 })
            if (url.endsWith("/install.sha256")) return new Response("not-a-digest\n", { status: 200 })
            return new Response("not found", { status: 404 })
          },
        },
        () => Installation.upgrade("curl", "5.3.0"),
      )

      await expect(promise).rejects.toThrow(/sidecar does not contain a SHA-256 digest/)
    })

    test("proceeds when the installer script sha256 sidecar matches", async () => {
      const script = "#!/bin/bash\necho verified\n"
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script))
      const expected = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")

      await withTestDependencies(
        {
          platform: "linux",
          fetch: (url) => {
            if (url.endsWith("/install")) return new Response(script, { status: 200 })
            if (url.endsWith("/install.sha256"))
              return new Response(`${expected.toUpperCase()}  install\n`, { status: 200 })
            return new Response("not found", { status: 404 })
          },
        },
        () => Installation.upgrade("curl", "5.3.0"),
      )
    })
  })
})
