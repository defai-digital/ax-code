import { expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { Instance, tmpdir } from "./harness"
import { LSPClient } from "../src/client"
import { LSPServer } from "../src/server"
import { aggregateEnvelope, collect } from "../src/diagnostics"
import { resolveNativeTypescript } from "../src/typescript-native"

test.each(["low", "normal"])("native TypeScript semantics and diagnostic updates (%s)", async (profile) => {
  vi.stubEnv("AX_CODE_MEMORY_PROFILE", profile)
  await using tmp = await tmpdir()
  await fs.writeFile(path.join(tmp.path, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }))
  const source = path.join(tmp.path, "source.ts")
  await fs.writeFile(source, 'export const answer: number = "wrong"\nexport const use = answer\n')
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const native = resolveNativeTypescript()
        expect(execFileSync(native.executable, ["--version"], { encoding: "utf8" }).trim()).toBe(
          `Version ${native.version}`,
        )
        const server = await LSPServer.Typescript.spawn(tmp.path)
        expect(server).toBeDefined()
        const child = server!.process
        expect(child.spawnargs).toEqual([native.executable, "--lsp", "--stdio"])
        let client: Awaited<ReturnType<typeof LSPClient.create>> | undefined
        try {
          client = await LSPClient.create({ serverID: "typescript", server: server!, root: tmp.path })
          await client.notify.open({ path: source })
          await collect([client])
          expect(client.diagnostics.get(source)?.some((item) => item.code === 2322)).toBe(true)
          const uri = pathToFileURL(source).href
          const point = { textDocument: { uri }, position: { line: 1, character: 21 } }
          expect(JSON.stringify(await client.connection.sendRequest("textDocument/hover", point))).toContain("number")
          const definitions = await client.connection.sendRequest<unknown[]>("textDocument/definition", point)
          expect(definitions.length).toBeGreaterThan(0)
          const references = await client.connection.sendRequest<unknown[]>("textDocument/references", {
            ...point,
            context: { includeDeclaration: true },
          })
          expect(references.length).toBe(2)
          const symbols = await client.connection.sendRequest<unknown[]>("textDocument/documentSymbol", {
            textDocument: { uri },
          })
          expect(symbols.length).toBe(2)
          await fs.writeFile(source, "export const answer: number = 42\nexport const use = answer\n")
          await client.notify.open({ path: source, waitForDiagnostics: true })
          await collect([client])
          expect(client.diagnostics.get(source)).toEqual([])
          await client.notify.close({ path: source })
          expect(client.diagnostics.has(source)).toBe(false)
          await client.notify.open({ path: source, waitForDiagnostics: true })
          await collect([client])
          expect(client.diagnostics.get(source)).toEqual([])
          const dependent = path.join(tmp.path, "dependent.ts")
          await fs.writeFile(dependent, 'import { answer } from "./source"\nexport const value: number = answer\n')
          await client.notify.open({ path: dependent, waitForDiagnostics: true })
          await collect([client])
          expect(client.diagnostics.get(dependent)).toEqual([])
          expect((await aggregateEnvelope([client], dependent)).degraded).toBe(false)
          await fs.writeFile(source, 'export const answer = "changed"\nexport const use = answer\n')
          await client.notify.open({ path: source, waitForDiagnostics: true })
          const changed = await aggregateEnvelope([client], dependent)
          expect(changed.degraded || changed.data.some((item) => item.code === 2322)).toBe(true)
          await client.notify.open({ path: dependent, waitForDiagnostics: true })
          await collect([client])
          expect(client.diagnostics.get(dependent)?.some((item) => item.code === 2322)).toBe(true)
        } finally {
          if (client) await client.shutdown()
          else child.kill("SIGKILL")
        }
      },
    })
  } finally {
    vi.unstubAllEnvs()
  }
})

test("missing or mismatched native packages fail instead of falling back to JS", async () => {
  await using tmp = await tmpdir()
  const manifest = path.join(tmp.path, "package.json")
  const platformName = `@typescript/typescript-${process.platform}-${process.arch}`
  await fs.writeFile(
    manifest,
    JSON.stringify({ name: "typescript", version: "7.0.2", optionalDependencies: { [platformName]: "7.0.2" } }),
  )
  // Prevent ancestor resolution by declaring a local mismatched package.
  const platformDir = path.join(tmp.path, "node_modules", platformName)
  await fs.mkdir(platformDir, { recursive: true })
  await fs.writeFile(path.join(platformDir, "package.json"), JSON.stringify({ name: platformName, version: "7.0.1" }))
  expect(() => resolveNativeTypescript({ packageJsonPath: manifest })).toThrow("TypeScript 7 native LSP is unavailable")
  await fs.writeFile(path.join(platformDir, "package.json"), JSON.stringify({ name: platformName, version: "7.0.2" }))
  expect(() => resolveNativeTypescript({ packageJsonPath: manifest })).toThrow("TypeScript 7 native LSP is unavailable")
  expect(() => resolveNativeTypescript({ platform: "win32", arch: "unsupported" })).toThrow(
    "TypeScript 7 native LSP is unavailable",
  )
})

test("native saved diagnostics remain current during filesystem watch traffic", async () => {
  await using tmp = await tmpdir()
  const modules = 2000
  await fs.writeFile(path.join(tmp.path, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }))
  for (let offset = 0; offset < modules; offset += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const index = offset + i
        return fs.writeFile(path.join(tmp.path, `module${index}.ts`), `export const value${index} = ${index}\n`)
      }),
    )
  }
  const source = path.join(tmp.path, "source.ts")
  const imports = Array.from({ length: modules }, (_, i) => `import { value${i} } from "./module${i}"`).join("\n")
  const content = (wrong: boolean) => `${imports}\nexport const answer: number = ${wrong ? '\"wrong\"' : "42"}\n`
  await fs.writeFile(source, content(true))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const server = await LSPServer.Typescript.spawn(tmp.path)
      expect(server).toBeDefined()
      let client: Awaited<ReturnType<typeof LSPClient.create>> | undefined
      try {
        client = await LSPClient.create({ serverID: "typescript", server: server!, root: tmp.path })
        for (let round = 0; round < 300; round++) {
          const wrong = round % 2 === 0
          await fs.writeFile(source, content(wrong))
          await Promise.all(
            Array.from({ length: 8 }, () => client!.notify.open({ path: source, waitForDiagnostics: true })),
          )
          const snapshot = await collect([client])
          expect(
            snapshot[source]?.some((item) => item.code === 2322),
            `saved edit ${round}`,
          ).toBe(wrong)
          // Give native filesystem events an opportunity to interleave with edits.
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      } finally {
        if (client) await client.shutdown()
        else server?.process.kill("SIGKILL")
      }
    },
  })
}, 120_000)
