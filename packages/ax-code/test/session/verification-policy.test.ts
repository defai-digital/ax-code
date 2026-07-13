import { describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { VerificationPolicy } from "../../src/session/verification-policy"
import { tmpdir } from "../fixture/fixture"

describe("VerificationPolicy.detectEcosystem", () => {
  test("prefers node when package.json is present", () => {
    expect(VerificationPolicy.detectEcosystem({ hasPackageJson: true, hasCargoToml: true })).toBe("node")
  })

  test("detects rust, go, python", () => {
    expect(VerificationPolicy.detectEcosystem({ hasCargoToml: true })).toBe("rust")
    expect(VerificationPolicy.detectEcosystem({ hasGoMod: true })).toBe("go")
    expect(VerificationPolicy.detectEcosystem({ hasPyproject: true })).toBe("python")
    expect(VerificationPolicy.detectEcosystem({ hasRequirementsTxt: true })).toBe("python")
    expect(VerificationPolicy.detectEcosystem({})).toBe("unknown")
  })
})

describe("VerificationPolicy.preferredCommands", () => {
  test("builds node commands from scripts and package manager", () => {
    const commands = VerificationPolicy.preferredCommands({
      hasPackageJson: true,
      packageManager: "pnpm",
      scripts: { typecheck: true, lint: true, test: true },
    })
    expect(commands.ecosystem).toBe("node")
    expect(commands.typecheck).toBe("pnpm run typecheck")
    expect(commands.lint).toBe("pnpm run lint")
    expect(commands.test).toBe("pnpm test")
    expect(commands.preferred).toEqual(["pnpm test", "pnpm run typecheck", "pnpm run lint"])
  })

  test("builds rust defaults", () => {
    const commands = VerificationPolicy.preferredCommands({ hasCargoToml: true })
    expect(commands.ecosystem).toBe("rust")
    expect(commands.typecheck).toBe("cargo check")
    expect(commands.test).toBe("cargo test")
    expect(commands.preferred[0]).toBe("cargo test")
  })

  test("empty scripts yields empty preferred for node", () => {
    const commands = VerificationPolicy.preferredCommands({
      hasPackageJson: true,
      packageManager: "npm",
      scripts: {},
    })
    expect(commands.preferred).toEqual([])
  })

  test("filesystem resolution does not revive an intentional failing test placeholder", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({ scripts: { test: "echo 'tests unsupported' && exit 1" } }),
    )

    const commands = await VerificationPolicy.resolvePreferredCommands(tmp.path)
    expect(commands.test).toBeNull()
    expect(commands.preferred).toEqual([])
  })
})

describe("VerificationPolicy command classification", () => {
  test("marks observation and no-op commands as trivial", () => {
    for (const command of ["echo done", "ls -la", "git status", "cat file.ts", "true", "sleep 1"]) {
      expect(VerificationPolicy.isTrivialVerificationCommand(command)).toBe(true)
      expect(VerificationPolicy.looksLikeVerificationCommand(command)).toBe(false)
    }
  })

  test("marks real check commands as verification-like", () => {
    for (const command of ["bun test", "pnpm run typecheck", "cargo test", "pytest", "go test ./..."]) {
      expect(VerificationPolicy.isTrivialVerificationCommand(command)).toBe(false)
      expect(VerificationPolicy.looksLikeVerificationCommand(command)).toBe(true)
    }
  })
})

describe("VerificationPolicy.renderVerificationProtocol", () => {
  test("includes preferred commands and sandwich guidance", () => {
    const block = VerificationPolicy.renderVerificationProtocol({
      ecosystem: "node",
      typecheck: "pnpm run typecheck",
      lint: null,
      test: "pnpm test",
      preferred: ["pnpm test", "pnpm run typecheck"],
    })
    expect(block).toContain("<verification_protocol>")
    expect(block).toContain("plan (or a short decision frame) → implement → verify")
    expect(block).toContain("pnpm test")
    expect(block).toContain("verify_project")
    expect(block).toContain("node")
  })
})
