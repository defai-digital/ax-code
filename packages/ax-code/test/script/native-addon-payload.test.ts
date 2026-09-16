import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "vitest"
import {
  inspectNativeAddonPayload,
  nativeAddonIncompleteMessage,
  NATIVE_ADDON_PACKAGES,
} from "../../script/native-addon-payload"
import { tmpdir } from "../fixture/fixture"

test("requires the loader shim and host binary before an addon can be staged", async () => {
  await using tmp = await tmpdir()
  const pkg = path.join(tmp.path, "index-core")
  await mkdir(pkg)
  await writeFile(path.join(pkg, "package.json"), "{}\n")

  expect(inspectNativeAddonPayload(pkg, "index-core")).toMatchObject({
    ready: false,
    missing: ["index.js", "index-core.node"],
  })

  await writeFile(path.join(pkg, "index.js"), "module.exports = {}\n")
  expect(inspectNativeAddonPayload(pkg, "index-core").missing).toEqual(["index-core.node"])

  await writeFile(path.join(pkg, "index-core.node"), "")
  expect(inspectNativeAddonPayload(pkg, "index-core")).toMatchObject({ ready: true, missing: [] })
})

test("covers every runtime-copied addon and names the rebuild command", () => {
  expect(NATIVE_ADDON_PACKAGES.map((pkg) => pkg.name)).toEqual(["fs", "diff", "parser", "index-core"])
  expect(nativeAddonIncompleteMessage("parser", ["index.js", "ax-code-parser.node"], "/runtime")).toBe(
    "native addon parser is incomplete in /runtime (missing index.js, ax-code-parser.node); run pnpm build:native",
  )
})
