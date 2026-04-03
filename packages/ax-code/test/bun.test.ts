import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BunProc } from "../src/bun"

describe("BunProc registry structural guard", () => {
  test("should not contain hardcoded registry parameters", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that no hardcoded registry is present
    expect(content).not.toContain("--registry=")
    expect(content).not.toContain("hasNpmRcConfig")
    expect(content).not.toContain("NpmRc")
  })

  test("should use Bun's default registry resolution", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Verify that it uses Bun's default resolution
    expect(content).toContain("Bun's default registry resolution")
    expect(content).toContain("Bun will use them automatically")
    expect(content).toContain("No need to pass --registry flag")
  })

  test("should have correct command structure without registry", async () => {
    // Read the bun/index.ts file
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    // Extract the install function
    const installFunctionMatch = content.match(/export async function install[\s\S]*?^  }/m)
    expect(installFunctionMatch).toBeTruthy()

    if (installFunctionMatch) {
      const installFunction = installFunctionMatch[0]

      // Verify expected arguments are present
      expect(installFunction).toContain("installArgs(pkg, version)")
      expect(installFunction).toContain("Global.Path.cache")

      // Verify no registry argument is added
      expect(installFunction).not.toContain('"--registry"')
      expect(installFunction).not.toContain('args.push("--registry')
    }
  })
})

describe("BunProc registry behavior", () => {
  test("builds install args without registry flags", () => {
    const args = BunProc.installArgs("foo", "1.2.3", {
      proxied: false,
      ci: false,
      cwd: "/tmp/cache",
    })

    expect(args).toEqual(["add", "--force", "--exact", "--cwd", "/tmp/cache", "foo@1.2.3"])
    expect(args).not.toContain("--registry")
  })

  test("adds no-cache when proxied", () => {
    const args = BunProc.installArgs("foo", "latest", {
      proxied: true,
      ci: false,
      cwd: "/tmp/cache",
    })

    expect(args).toContain("--no-cache")
  })
})
