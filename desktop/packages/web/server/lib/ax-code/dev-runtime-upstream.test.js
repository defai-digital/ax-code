import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createDevRuntimeUpstreamWriter } from "./dev-runtime-upstream.js"

const tmpDirs = []

const makeTmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-runtime-upstream-test-"))
  tmpDirs.push(dir)
  return dir
}

const fakeProcessRef = () => ({ pid: 4321, once: () => {} })

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

describe("createDevRuntimeUpstreamWriter", () => {
  it("stays inert when no upstream file path is configured", () => {
    const writer = createDevRuntimeUpstreamWriter({
      filePath: "",
      getAxCodeAuthHeaders: () => ({ Authorization: "Basic dGVzdA==" }),
      processRef: fakeProcessRef(),
    })

    expect(writer.active).toBe(false)
    expect(() => writer.publish("http://127.0.0.1:4096")).not.toThrow()
    expect(() => writer.remove()).not.toThrow()
  })

  it("publishes origin and authorization to a 0600 file", () => {
    const filePath = path.join(makeTmpDir(), "dev-runtime-upstream.json")
    const writer = createDevRuntimeUpstreamWriter({
      filePath,
      getAxCodeAuthHeaders: () => ({ Authorization: "Basic dGVzdA==" }),
      processRef: fakeProcessRef(),
    })

    expect(writer.active).toBe(true)
    writer.publish("http://127.0.0.1:4096/")

    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"))
    expect(payload.version).toBe(1)
    expect(payload.origin).toBe("http://127.0.0.1:4096")
    expect(payload.authorization).toBe("Basic dGVzdA==")
    expect(typeof payload.updatedAt).toBe("string")

    const mode = fs.statSync(filePath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("omits the authorization field when no credential is available", () => {
    const filePath = path.join(makeTmpDir(), "dev-runtime-upstream.json")
    const writer = createDevRuntimeUpstreamWriter({
      filePath,
      getAxCodeAuthHeaders: () => ({}),
      processRef: fakeProcessRef(),
    })

    writer.publish("http://127.0.0.1:4096")
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"))
    expect("authorization" in payload).toBe(false)
  })

  it("removes the file when the runtime origin goes away", () => {
    const filePath = path.join(makeTmpDir(), "dev-runtime-upstream.json")
    const writer = createDevRuntimeUpstreamWriter({
      filePath,
      getAxCodeAuthHeaders: () => ({ Authorization: "Basic dGVzdA==" }),
      processRef: fakeProcessRef(),
    })

    writer.publish("http://127.0.0.1:4096")
    expect(fs.existsSync(filePath)).toBe(true)

    writer.publish(null)
    expect(fs.existsSync(filePath)).toBe(false)

    // remove() is idempotent.
    writer.remove()
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it("rewrites the file on every origin transition without leaking tmp files", () => {
    const dir = makeTmpDir()
    const filePath = path.join(dir, "dev-runtime-upstream.json")
    const writer = createDevRuntimeUpstreamWriter({
      filePath,
      getAxCodeAuthHeaders: () => ({ Authorization: "Basic dGVzdA==" }),
      processRef: fakeProcessRef(),
    })

    writer.publish("http://127.0.0.1:4096")
    writer.publish("http://127.0.0.1:51234")

    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"))
    expect(payload.origin).toBe("http://127.0.0.1:51234")
    expect(fs.readdirSync(dir)).toEqual(["dev-runtime-upstream.json"])
  })

  it("registers an exit hook that removes the file", () => {
    const filePath = path.join(makeTmpDir(), "dev-runtime-upstream.json")
    let exitHandler = null
    const processRef = {
      pid: 4321,
      once: (event, handler) => {
        if (event === "exit") exitHandler = handler
      },
    }
    const writer = createDevRuntimeUpstreamWriter({
      filePath,
      getAxCodeAuthHeaders: () => ({}),
      processRef,
    })

    writer.publish("http://127.0.0.1:4096")
    expect(fs.existsSync(filePath)).toBe(true)

    expect(typeof exitHandler).toBe("function")
    exitHandler()
    expect(fs.existsSync(filePath)).toBe(false)
  })
})
