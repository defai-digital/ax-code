import { describe, expect, test, vi } from "vitest"
import type { Context } from "hono"
import fs from "fs/promises"
import path from "path"
import { isDangerousRoot, requestDirectory } from "../../src/server/request-directory"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// Minimal Hono context: requestDirectory only reads query/header and (on
// rejection) builds the error Response through c.json.
function fakeContext(directory?: string): Context {
  return {
    req: {
      query: (name: string) => (name === "directory" ? directory : undefined),
      header: () => undefined,
    },
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
  } as unknown as Context
}

describe("isDangerousRoot", () => {
  test("blocks POSIX system roots", () => {
    expect(isDangerousRoot("/")).toBe(true)
    expect(isDangerousRoot("/etc")).toBe(true)
    expect(isDangerousRoot("/tmp")).toBe(true)
  })

  test("allows ordinary POSIX directories", () => {
    expect(isDangerousRoot("/home/user/project")).toBe(false)
  })

  test("blocks the Windows system drive root", () => {
    expect(isDangerousRoot("C:\\")).toBe(true)
    expect(isDangerousRoot("c:\\")).toBe(true)
    expect(isDangerousRoot("C:/")).toBe(true)
  })

  test("blocks Windows system directories regardless of casing or separators", () => {
    expect(isDangerousRoot("C:\\Windows")).toBe(true)
    expect(isDangerousRoot("c:\\windows")).toBe(true)
    expect(isDangerousRoot("C:/Windows")).toBe(true)
    expect(isDangerousRoot("C:\\Program Files")).toBe(true)
    expect(isDangerousRoot("c:/program files (x86)")).toBe(true)
  })

  test("does not over-block Windows paths beyond the listed roots", () => {
    expect(isDangerousRoot("C:\\Users\\alice\\project")).toBe(false)
    expect(isDangerousRoot("C:\\Windows\\System32")).toBe(false)
    expect(isDangerousRoot("D:\\")).toBe(false)
  })

  test("does not false-positive on POSIX paths resembling drive roots", () => {
    expect(isDangerousRoot("/c:/windows")).toBe(false)
  })
})

describe("requestDirectory", () => {
  test("rejects a dangerous root with a 400 response", async () => {
    const result = requestDirectory(fakeContext("/etc"))
    expect(result).toBeInstanceOf(Response)
    const response = result as Response
    expect(response.status).toBe(400)
    expect((await response.json()).message).toBe("Directory is not allowed")
  })

  test("resolves an ordinary project directory", async () => {
    await using tmp = await tmpdir()
    const result = requestDirectory(fakeContext(tmp.path))
    expect(typeof result).toBe("string")
  })

  test("rejects a sensitive home directory and re-resolves when HOME changes", async () => {
    const original = process.env.HOME
    try {
      await using first = await tmpdir()
      await using second = await tmpdir()
      await fs.mkdir(path.join(first.path, ".ssh"))
      await fs.mkdir(path.join(second.path, ".ssh"))

      process.env.HOME = first.path
      expect(requestDirectory(fakeContext(path.join(first.path, ".ssh")))).toBeInstanceOf(Response)

      // The memo is keyed on the raw homedir, so a changed HOME must be picked
      // up rather than answering from the first resolution.
      process.env.HOME = second.path
      const other = requestDirectory(fakeContext(path.join(second.path, ".ssh")))
      expect(other).toBeInstanceOf(Response)
      expect((await (other as Response).json()).message).toBe("Directory is not allowed")
    } finally {
      if (original === undefined) delete process.env.HOME
      else process.env.HOME = original
    }
  })

  test("does not cache a home whose resolution failed", async () => {
    const original = process.env.HOME
    const originalResolve = Filesystem.resolve
    try {
      await using home = await tmpdir()
      await fs.mkdir(path.join(home.path, ".ssh"))
      process.env.HOME = home.path
      const ssh = path.join(home.path, ".ssh")

      // A realpath failure that is not ENOENT (EACCES/EIO/ELOOP) would leave
      // the denylist answering from the previous home's entries if the failed
      // resolution were memoized — allowing the new home's sensitive dirs.
      const resolve = vi.spyOn(Filesystem, "resolve").mockImplementation((p) => {
        if (p === home.path) throw Object.assign(new Error("simulated EIO"), { code: "EIO" })
        return originalResolve(p)
      })
      try {
        expect(() => requestDirectory(fakeContext(ssh))).toThrow()
        expect(() => requestDirectory(fakeContext(ssh))).toThrow()
      } finally {
        resolve.mockRestore()
      }
    } finally {
      if (original === undefined) delete process.env.HOME
      else process.env.HOME = original
    }
  })
})
