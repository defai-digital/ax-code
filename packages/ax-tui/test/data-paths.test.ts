import path from "node:path"
import { expect, test } from "vitest"
import { DataPathsManager, getDataPaths } from "../src/lib/data-paths.js"

test("default configuration and data paths use the AX TUI namespace", () => {
  const paths = new DataPathsManager()
  expect(paths.appName).toBe("ax-tui")
  expect(path.basename(paths.globalConfigPath)).toBe("ax-tui")
  expect(path.basename(paths.globalDataPath)).toBe("ax-tui")
  expect(path.basename(paths.localConfigFile)).toBe(".ax-tui.ts")
  expect(getDataPaths()).toBe(getDataPaths())
  expect(getDataPaths().appName).toBe("ax-tui")
})

test("custom application names invalidate cached paths and reject directory traversal", () => {
  const paths = new DataPathsManager()
  const original = paths.toObject()
  const changes: unknown[] = []
  paths.on("paths:changed", (value) => changes.push(value))
  paths.appName = "example-app"
  const changed = paths.toObject()
  expect(changed.globalConfigPath).not.toBe(original.globalConfigPath)
  expect(path.basename(changed.globalConfigPath)).toBe("example-app")
  expect(path.basename(changed.globalDataPath)).toBe("example-app")
  expect(changed.globalConfigFile).toBe(path.join(changed.globalConfigPath, "init.ts"))
  expect(path.basename(changed.localConfigFile)).toBe(".example-app.ts")
  expect(changes).toEqual([changed])
  expect(() => {
    paths.appName = "../outside"
  }).toThrow("Invalid app name")
  expect(paths.toObject()).toEqual(changed)
})
