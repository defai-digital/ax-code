import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import typescript from "typescript"
import { afterEach, describe, expect, test } from "vitest"

const sourcePath = resolve(import.meta.dirname, "../src/programmatic/types.ts")
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

type ErrorModule = typeof import("../src/programmatic/types")

// Transpile the error module into its own directory and import it, so each call
// produces a genuinely separate module instance with its own class identities.
async function loadCopy(source: string): Promise<ErrorModule> {
  const dir = await mkdtemp(join(tmpdir(), "ax-code-sdk-errors-"))
  tempDirs.push(dir)
  await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }))
  const output = typescript.transpileModule(source, {
    fileName: "types.ts",
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      moduleResolution: typescript.ModuleResolutionKind.Bundler,
    },
  }).outputText
  await writeFile(join(dir, "types.js"), output)
  return (await import(pathToFileURL(join(dir, "types.js")).href)) as ErrorModule
}

describe("error classes across module instances", () => {
  test("instanceof matches across separate SDK copies", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)
    const copyB = await loadCopy(source)

    expect(copyA.ProviderError).not.toBe(copyB.ProviderError)

    const providerB = new copyB.ProviderError("rate", { status: 429 })
    expect(providerB instanceof copyA.ProviderError).toBe(true)
    expect(providerB instanceof copyA.AxCodeError).toBe(true)
    expect(providerB instanceof copyB.ProviderError).toBe(true)

    const toolB = new copyB.ToolError("bash", "boom")
    expect(toolB instanceof copyA.ProviderError).toBe(false)
    expect(toolB instanceof copyA.ToolError).toBe(true)
    expect(toolB instanceof copyA.AxCodeError).toBe(true)

    const timeoutB = new copyB.TimeoutError(5000, "agent.run")
    expect(timeoutB instanceof copyA.TimeoutError).toBe(true)
    expect(timeoutB.timeout).toBe(5000)
  })

  test("matches on the brand, never on code or name", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)
    const copyB = await loadCopy(source)

    const axB = new copyB.AxCodeError("x", "PROVIDER_ERROR")
    expect(axB instanceof copyA.ProviderError).toBe(false)
    expect(axB instanceof copyA.AxCodeError).toBe(true)

    const plain = Object.assign(new Error("plain"), { code: "PROVIDER_ERROR" })
    expect(plain instanceof copyA.AxCodeError).toBe(false)
    expect(plain instanceof copyB.AxCodeError).toBe(false)
  })

  test("application subclass keeps prototype semantics but brands as its SDK parent", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)
    const copyB = await loadCopy(source)

    class Custom extends copyA.ProviderError {
      constructor() {
        super("custom")
      }
    }

    const custom = new Custom()
    expect(custom instanceof copyB.ProviderError).toBe(true)
    expect(custom instanceof copyA.ProviderError).toBe(true)

    // `Custom` has no own kind, so it must not claim a foreign ProviderError.
    const providerB = new copyB.ProviderError("rate")
    expect(providerB instanceof Custom).toBe(false)
  })

  test("ignores application static kind spoofs", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)

    class Spoof extends copyA.AxCodeError {
      static kind = "ProviderError"
      constructor() {
        super("x", "APP")
      }
    }
    const spoof = new Spoof()
    expect(spoof instanceof copyA.ProviderError).toBe(false)
    expect(spoof instanceof copyA.AxCodeError).toBe(true)

    class SiblingA extends copyA.ProviderError {
      static kind = "ProviderError"
      constructor() {
        super("a")
      }
    }
    class SiblingB extends copyA.ProviderError {
      static kind = "ProviderError"
      constructor() {
        super("b")
      }
    }
    const sibling = new SiblingA()
    expect(sibling instanceof SiblingB).toBe(false)
    expect(sibling instanceof copyA.ProviderError).toBe(true)
  })

  test("brands application subclasses by their SDK parent regardless of static kind", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)
    const copyB = await loadCopy(source)

    class RateLimit extends copyA.ProviderError {
      static kind = "RateLimitError"
      constructor() {
        super("rate", { status: 429 })
      }
    }
    const rateLimit = new RateLimit()
    expect(rateLimit instanceof copyB.ProviderError).toBe(true)
    expect(rateLimit instanceof copyB.AxCodeError).toBe(true)

    class NumericKind extends copyA.ToolError {
      static kind = 42
      constructor() {
        super("bash", "boom")
      }
    }
    const numeric = new NumericKind()
    expect(numeric instanceof copyB.ToolError).toBe(true)
    expect(numeric instanceof copyB.AxCodeError).toBe(true)
  })

  test("does not match plain objects carrying the brand symbol", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)
    const copyB = await loadCopy(source)
    const brand = Symbol.for("@defai-digital/ax-code-sdk/error")

    const empty = { [brand]: "" }
    expect(empty instanceof copyA.AxCodeError).toBe(false)
    expect(empty instanceof copyB.AxCodeError).toBe(false)
    expect(empty instanceof copyA.ProviderError).toBe(false)

    const providerLookalike = { [brand]: "ProviderError" }
    expect(providerLookalike instanceof copyA.ProviderError).toBe(false)
    expect(providerLookalike instanceof copyB.ProviderError).toBe(false)
    expect(providerLookalike instanceof copyA.AxCodeError).toBe(false)

    // A real Error with an unregistered brand still does not match.
    const unknownBrand = Object.assign(new Error("x"), { [brand]: "nope" })
    expect(unknownBrand instanceof copyA.AxCodeError).toBe(false)
  })

  test("does not expose a public kind static", async () => {
    const source = await readFile(sourcePath, "utf8")
    const copyA = await loadCopy(source)
    for (const errorClass of [
      copyA.AxCodeError,
      copyA.ProviderError,
      copyA.TimeoutError,
      copyA.ToolError,
      copyA.PermissionError,
      copyA.AgentNotFoundError,
      copyA.DisposedError,
    ]) {
      expect(Object.prototype.hasOwnProperty.call(errorClass, "kind")).toBe(false)
    }
  })
})
