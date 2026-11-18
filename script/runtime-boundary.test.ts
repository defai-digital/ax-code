import { expect, test } from "vitest"
import { runtimeInterfaceImportAllowed } from "./runtime-boundary"

const root = "packages/ax-code/src/"

test.each([
  "sdk/programmatic.ts",
  "sdk/programmatic-impl.ts",
  "runtime/local-client.ts",
  "mcp/oauth-callback.ts",
  "control-plane/workspace-server/server.ts",
])("%s may use server adapters but cannot import CLI startup", (file) => {
  expect(runtimeInterfaceImportAllowed(root + file, root + "server/server.ts")).toBe(true)
  expect(runtimeInterfaceImportAllowed(root + file, root + "cli/bootstrap.ts")).toBe(false)
  expect(runtimeInterfaceImportAllowed(root + file, root + "cli/bootstrap/env.ts")).toBe(false)
})

test.each(["index.ts", "index-compiled.ts", "index-node.ts", "index-node-tui.ts"])(
  "%s is a CLI entry point",
  (file) => {
    expect(runtimeInterfaceImportAllowed(root + file, root + "cli/boot.ts")).toBe(true)
    expect(runtimeInterfaceImportAllowed(root + file, root + "server/server.ts")).toBe(true)
  },
)

test.each(["project/with-instance.ts", "runtime/flags.ts", "session/index.ts"])(
  "%s cannot depend on interface layers",
  (file) => {
    expect(runtimeInterfaceImportAllowed(root + file, root + "cli/bootstrap.ts")).toBe(false)
    expect(runtimeInterfaceImportAllowed(root + file, root + "server/server.ts")).toBe(false)
    expect(runtimeInterfaceImportAllowed(root + file, root + "project/instance.ts")).toBe(true)
  },
)

test("interface adapters retain access to other interface modules", () => {
  expect(runtimeInterfaceImportAllowed(root + "cli/bootstrap.ts", root + "server/server.ts")).toBe(true)
  expect(runtimeInterfaceImportAllowed(root + "server/routes/session.ts", root + "cli/boot.ts")).toBe(true)
})
