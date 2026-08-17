import { describe, expect, test } from "vitest"
import type { Context } from "hono"
import { isDangerousRoot, requestDirectory } from "../../src/server/request-directory"
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
})
