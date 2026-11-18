import { expect, test } from "vitest"
import { extractImportSpecifiers } from "./import-specifiers"
import { requiredImplementationFacade, runtimeInterfaceImportAllowed } from "./runtime-boundary"

const root = "packages/ax-code/src/"

test.each(["runtime/local-client.ts", "mcp/oauth-callback.ts", "control-plane/workspace-server/server.ts"])(
  "%s may use server adapters but cannot import CLI startup",
  (file) => {
    expect(runtimeInterfaceImportAllowed(root + file, root + "server/server.ts")).toBe(true)
    expect(runtimeInterfaceImportAllowed(root + file, root + "cli/bootstrap.ts")).toBe(false)
    expect(runtimeInterfaceImportAllowed(root + file, root + "cli/bootstrap/env.ts")).toBe(false)
  },
)

test.each(["index.ts", "index-compiled.ts", "index-node.ts", "index-node-tui.ts"])(
  "%s is a CLI entry point",
  (file) => {
    expect(runtimeInterfaceImportAllowed(root + file, root + "cli/boot.ts")).toBe(true)
    expect(runtimeInterfaceImportAllowed(root + file, root + "server/server.ts")).toBe(true)
  },
)

test.each([
  "project/with-instance.ts",
  "runtime/flags.ts",
  "session/index.ts",
  "sdk/programmatic.ts",
  "sdk/programmatic-impl.ts",
])("%s cannot depend on interface layers", (file) => {
  expect(runtimeInterfaceImportAllowed(root + file, root + "cli/bootstrap.ts")).toBe(false)
  expect(runtimeInterfaceImportAllowed(root + file, root + "server/server.ts")).toBe(false)
  expect(runtimeInterfaceImportAllowed(root + file, root + "project/instance.ts")).toBe(true)
})

test("interface adapters retain access to other interface modules", () => {
  expect(runtimeInterfaceImportAllowed(root + "cli/bootstrap.ts", root + "server/server.ts")).toBe(true)
  expect(runtimeInterfaceImportAllowed(root + "server/routes/session.ts", root + "cli/boot.ts")).toBe(true)
})

test.each(["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])(
  "implementation imports using the %s extension must use an existing facade",
  (extension) => {
    const facade = root + "provider/provider.ts"
    expect(
      requiredImplementationFacade(
        root + "visual/router.ts",
        root + "provider/provider-impl" + extension,
        new Set([facade]),
      ),
    ).toBe(facade)
  },
)

test("facades may expose their implementations, including authored extension variants", () => {
  const facades = [root + "provider/provider.ts", root + "provider/provider.js"]
  for (const facade of facades) {
    expect(requiredImplementationFacade(facade, root + "provider/provider-impl", new Set(facades))).toBeUndefined()
  }
})

test("standalone implementations and ordinary helpers need no invented facade", () => {
  const source = root + "cli/boot.ts"
  const files = new Set([source, root + "cli/cmd/goal-impl.ts", root + "provider/provider.ts"])
  expect(requiredImplementationFacade(source, root + "cli/cmd/goal-impl", files)).toBeUndefined()
  expect(requiredImplementationFacade(source, root + "provider/provider", files)).toBeUndefined()
  expect(requiredImplementationFacade(source, root + "provider/provider-impl-helper", files)).toBeUndefined()
})

test("the facade boundary covers runtime imports, type contracts, re-exports and dynamic imports", () => {
  const target = "@/provider/provider-impl"
  const code = [
    `import { Provider } from "${target}"`,
    `import type { Provider } from "${target}"`,
    `type ProviderModule = typeof import("${target}")`,
    `export { Provider } from "${target}"`,
    `const load = () => import("${target}")`,
    `const common = require("${target}")`,
    `// import { Provider } from "${target}"`,
    `const example = 'import("${target}")'`,
  ].join("\n")
  const imports = extractImportSpecifiers(code)
  expect(imports).toHaveLength(6)
  const facade = root + "provider/provider.ts"
  for (const { specifier } of imports) {
    expect(requiredImplementationFacade(root + "tool/task.ts", root + specifier.slice(2), new Set([facade]))).toBe(
      facade,
    )
  }
})
