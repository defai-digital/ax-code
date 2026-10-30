import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, test } from "vitest"
// @ts-expect-error The standalone Node verifier intentionally has no build dependency.
import { verifyAkittySdk } from "./verify-akitty-sdk.mjs"

const source = fileURLToPath(new URL("../packages/akitty-sdk", import.meta.url))
const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "akitty-sdk-pin-"))
  directories.push(directory)
  cpSync(source, directory, { recursive: true, filter: (name) => !name.includes("node_modules") })
  return directory
}

test("verifies the SDK pin without a sibling checkout", () => {
  expect(verifyAkittySdk().version).toBe("0.1.0")
})

test("rejects changed runtime bytes and added package files", () => {
  const changed = fixture()
  writeFileSync(path.join(changed, "vendor/dist/index.js"), "export const changed = true\n")
  expect(() => verifyAkittySdk(changed)).toThrow("byte drift")
  const added = fixture()
  writeFileSync(path.join(added, "vendor/extra.js"), "")
  expect(() => verifyAkittySdk(added)).toThrow("inventory drift")
})

test("rejects identity changes and receipt paths outside the package", () => {
  const directory = fixture()
  const manifest = path.join(directory, "package.json")
  const original = readFileSync(manifest, "utf8")
  writeFileSync(manifest, original.replace('"0.1.0"', '"0.2.0"'))
  expect(() => verifyAkittySdk(directory)).toThrow("identity drift")
  writeFileSync(manifest, original)
  const receipt = path.join(directory, "SOURCE.json")
  writeFileSync(receipt, readFileSync(receipt, "utf8").replace("vendor/LICENSE", "../LICENSE"))
  expect(() => verifyAkittySdk(directory)).toThrow("inventory drift")
})
