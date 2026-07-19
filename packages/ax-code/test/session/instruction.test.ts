import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { InstructionPrompt } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"
import { Ssrf } from "../../src/util/ssrf"
import { Filesystem } from "../../src/util/filesystem"
import { Glob } from "../../src/util/glob"
import { Config } from "../../src/config/config"

describe("InstructionPrompt.resolve", () => {
  test("returns empty when AGENTS.md is at project root (already in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Root Instructions")
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "AGENTS.md"))).toBe(true)

        const results = await InstructionPrompt.resolve([], path.join(tmp.path, "src", "file.ts"), "test-message-1")
        expect(results).toEqual([])
      },
    })
  })

  test("returns AGENTS.md from subdirectory (not in systemPaths)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "subdir"), { recursive: true })
        await fs.writeFile(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await fs.mkdir(path.join(dir, "subdir", "nested"), { recursive: true })
        await fs.writeFile(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "subdir", "AGENTS.md"))).toBe(false)

        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "subdir", "nested", "file.ts"),
          "test-message-2",
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })

  test("does not load instructions from sibling directories with matching prefixes", async () => {
    await using tmp = await tmpdir()
    const sibling = `${tmp.path}-sibling`
    const nested = path.join(sibling, "nested")

    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(path.join(sibling, "AGENTS.md"), "# Sibling Instructions")
    await fs.writeFile(path.join(nested, "file.ts"), "const x = 1")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const results = await InstructionPrompt.resolve([], path.join(nested, "file.ts"), "test-message-sibling")
          expect(results).toEqual([])
        },
      })
    } finally {
      await fs.rm(sibling, { recursive: true, force: true })
    }
  })

  test("doesn't reload AGENTS.md when reading it directly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "subdir"), { recursive: true })
        await fs.writeFile(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await fs.mkdir(path.join(dir, "subdir", "nested"), { recursive: true })
        await fs.writeFile(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "subdir", "AGENTS.md")
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = await InstructionPrompt.resolve([], filepath, "test-message-2")
        expect(results).toEqual([])
      },
    })
  })

  test("does not use legacy project instruction files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AX.md"), "# Legacy AX Instructions")
        await fs.writeFile(path.join(dir, "CONTEXT.md"), "# Legacy Context Instructions")
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "file.ts"), "const x = 1")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.systemPaths()
        expect(system.has(path.join(tmp.path, "AX.md"))).toBe(false)
        expect(system.has(path.join(tmp.path, "CONTEXT.md"))).toBe(false)

        const results = await InstructionPrompt.resolve(
          [],
          path.join(tmp.path, "src", "file.ts"),
          "test-message-legacy",
        )
        expect(results).toEqual([])
      },
    })
  })

  test("surfaces unreadable nested instruction files", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "subdir"), { recursive: true })
        await fs.writeFile(path.join(dir, "subdir", "AGENTS.md"), "# Subdir Instructions")
        await fs.mkdir(path.join(dir, "subdir", "nested"), { recursive: true })
        await fs.writeFile(path.join(dir, "subdir", "nested", "file.ts"), "const x = 1")
      },
    })
    const instructionPath = path.join(tmp.path, "subdir", "AGENTS.md")
    await fs.chmod(instructionPath, 0)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            InstructionPrompt.resolve([], path.join(tmp.path, "subdir", "nested", "file.ts"), "test-message-eacces"),
          ).rejects.toMatchObject({ code: "EACCES" })
        },
      })
    } finally {
      await fs.chmod(instructionPath, 0o600)
    }
  })
})

describe("InstructionPrompt.systemPaths AX_CODE_CONFIG_DIR", () => {
  let originalConfigDir: string | undefined

  beforeEach(() => {
    originalConfigDir = process.env["AX_CODE_CONFIG_DIR"]
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env["AX_CODE_CONFIG_DIR"]
    } else {
      process.env["AX_CODE_CONFIG_DIR"] = originalConfigDir
    }
  })

  test("prefers AX_CODE_CONFIG_DIR AGENTS.md over global when both exist", async () => {
    await using profileTmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Profile Instructions")
      },
    })
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env["AX_CODE_CONFIG_DIR"] = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(true)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(false)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("falls back to global AGENTS.md when AX_CODE_CONFIG_DIR has no AGENTS.md", async () => {
    await using profileTmp = await tmpdir()
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    process.env["AX_CODE_CONFIG_DIR"] = profileTmp.path
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(profileTmp.path, "AGENTS.md"))).toBe(false)
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("uses global AGENTS.md when AX_CODE_CONFIG_DIR is not set", async () => {
    await using globalTmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "AGENTS.md"), "# Global Instructions")
      },
    })
    await using projectTmp = await tmpdir()

    delete process.env["AX_CODE_CONFIG_DIR"]
    const originalGlobalConfig = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path

    try {
      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(globalTmp.path, "AGENTS.md"))).toBe(true)
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = originalGlobalConfig
    }
  })

  test("rejects ~/ instruction paths that escape the home directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        instructions: ["~/../escaped.md"],
      },
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "escaped.md"), "# escaped")
      },
    })
    const fakeHome = path.join(tmp.path, "home")
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(Array.from(paths)).not.toContain(path.join(tmp.path, "escaped.md"))
        },
      })
    } finally {
      homedir.mockRestore()
    }
  })

  test("allows ~/ instruction paths that stay within the home directory", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({
      git: true,
      config: {
        instructions: ["~/rules.md"],
      },
    })
    const fakeHome = path.join(tmp.path, "home")
    await fs.mkdir(fakeHome, { recursive: true })
    await fs.writeFile(path.join(fakeHome, "rules.md"), "# home rules")
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(fakeHome, "rules.md"))).toBe(true)
        },
      })
    } finally {
      homedir.mockRestore()
    }
  })

  test("rejects ~/ instruction paths that resolve through symlinks outside the home directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        instructions: ["~/escape/AGENTS.md"],
      },
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "outside"), { recursive: true })
        await fs.writeFile(path.join(dir, "outside", "AGENTS.md"), "# outside")
      },
    })
    const fakeHome = path.join(tmp.path, "home")
    await fs.mkdir(fakeHome, { recursive: true })
    await fs.symlink(path.join(tmp.path, "outside"), path.join(fakeHome, "escape"))
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          expect(paths.has(path.join(tmp.path, "outside", "AGENTS.md"))).toBe(false)
        },
      })
    } finally {
      homedir.mockRestore()
    }
  })

  test("surfaces relative instruction glob failures", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        instructions: ["CUSTOM.md"],
      },
    })
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" })
    const globSpy = vi.spyOn(Filesystem, "globUp").mockRejectedValue(error)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(InstructionPrompt.systemPaths()).rejects.toMatchObject({ code: "EACCES" })
        },
      })
    } finally {
      globSpy.mockRestore()
    }
  })

  test("surfaces absolute instruction glob failures", async () => {
    await using tmp = await tmpdir({ git: true })
    const instructionPath = path.join(tmp.path, "private", "CUSTOM.md")
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" })
    const globSpy = vi.spyOn(Glob, "scan").mockRejectedValue(error)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const getSpy = vi.spyOn(Config, "get").mockResolvedValue({
            instructions: [instructionPath],
          } as Awaited<ReturnType<typeof Config.get>>)

          try {
            await expect(InstructionPrompt.systemPaths()).rejects.toMatchObject({ code: "EACCES" })
          } finally {
            getSpy.mockRestore()
          }
        },
      })
    } finally {
      globSpy.mockRestore()
    }
  })

  test.skipIf(process.platform === "win32")(
    "rejects relative instruction symlinks that escape the worktree",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await using outside = await tmpdir({
        init: async (dir) => fs.writeFile(path.join(dir, "PRIVATE.md"), "outside secret"),
      })
      await fs.symlink(path.join(outside.path, "PRIVATE.md"), path.join(tmp.path, "linked.md"))

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const getSpy = vi.spyOn(Config, "get").mockResolvedValue({
            instructions: ["linked.md"],
          } as Awaited<ReturnType<typeof Config.get>>)
          try {
            const paths = await InstructionPrompt.systemPaths()
            expect(paths.has(path.join(tmp.path, "linked.md"))).toBe(false)
          } finally {
            getSpy.mockRestore()
          }
        },
      })
    },
  )
})

describe("InstructionPrompt.system remote instructions", () => {
  test("loads HTTP instruction URLs case-insensitively", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({
      git: true,
      config: {
        instructions: ["HTTPS://example.com/AGENTS.md"],
      },
    })
    const assertSpy = vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    const fetchSpy = vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue(new Response("# Remote Instructions") as never)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const paths = await InstructionPrompt.systemPaths()
          const prompts = await InstructionPrompt.system()

          expect(Array.from(paths)).not.toContain("HTTPS://example.com/AGENTS.md")
          expect(assertSpy).toHaveBeenCalledWith("HTTPS://example.com/AGENTS.md", "instruction-url")
          expect(fetchSpy).toHaveBeenCalledWith("HTTPS://example.com/AGENTS.md", expect.any(Object))
          expect(prompts).toContain("Instructions from: HTTPS://example.com/AGENTS.md\n# Remote Instructions")
        },
      })
    } finally {
      assertSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

  test("ignores non-decimal remote instruction content-length headers", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({
      git: true,
      config: {
        instructions: ["https://example.com/AGENTS.md"],
      },
    })
    const assertSpy = vi.spyOn(Ssrf, "assertPublicUrl").mockResolvedValue(undefined as never)
    const fetchSpy = vi.spyOn(Ssrf, "pinnedFetch").mockResolvedValue(
      new Response("# Remote Instructions", {
        headers: { "content-length": "0x100000000" },
      }) as never,
    )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const prompts = await InstructionPrompt.system()

          expect(prompts).toContain("Instructions from: https://example.com/AGENTS.md\n# Remote Instructions")
        },
      })
    } finally {
      assertSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })
})
