import fs from "node:fs/promises"
import { hookRewriteApproval } from "../../../src/hooks/input-rewrite"
import { expect, test } from "vitest"
import {
  approvalInput,
  hookRewriteSummary,
  permissionCommandView,
  permissionRewriteView,
  permissionSearchView,
} from "../../../src/cli/tui/routes/session/permission-command-view-model"

test("approval shows the effective hook command with a generic changed-field explanation", () => {
  expect(
    permissionCommandView(
      {
        hookRewritten: true,
        effectiveInput: { command: "printf compromised > src/entry.ts" },
        changedFields: ["command"],
      },
      { command: "printf ok" },
    ),
  ).toEqual({ command: "printf compromised > src/entry.ts" })
})

test("only requests without a rewrite can fall back to the model command", () => {
  expect(permissionCommandView({}, { command: "printf ok" }).command).toBe("printf ok")
  expect(permissionCommandView({ hookRewritten: true }, { command: "printf ok" }).command).toBe("")
})

test("persisted tool cards show both audit values without changing replay input", () => {
  expect(hookRewriteSummary({ hookRewrite: { before: "original", after: "effective" } })).toBe("original -> effective")
  expect(hookRewriteSummary({ hookRewrite: { before: "original" } })).toBe("")
})

test("approvalInput renders the effective input of a rewritten call, not the persisted original", () => {
  const persisted = { filePath: "README.md", description: "Read docs" }
  const metadata = { hookRewritten: true, effectiveInput: { filePath: "customer-data.csv", description: "Read docs" } }
  expect(approvalInput(metadata, persisted)).toEqual({ filePath: "customer-data.csv", description: "Read docs" })
  expect(approvalInput({ hookRewritten: true, effectiveInput: { workdir: "/etc" } }, { workdir: "/tmp" })).toEqual({
    workdir: "/etc",
  })
})

test("approvalInput uses persisted input only without a rewrite; malformed carriers fail closed", () => {
  const persisted = { filePath: "README.md" }
  expect(approvalInput({}, persisted)).toBe(persisted)
  expect(approvalInput({ effectiveInput: { filePath: "x" } }, persisted)).toBe(persisted)
  expect(approvalInput({ hookRewritten: true, effectiveInput: "oops" }, persisted)).toEqual({})
  expect(approvalInput({ hookRewritten: true, effectiveInput: ["x"] }, persisted)).toEqual({})
})

test.each(["grep", "glob"])("%s approval exposes the effective search path and include", () => {
  const original = { pattern: "needle", path: "/project", include: "*.md" }
  const effective = { pattern: "needle", path: "/private", include: "*.csv" }
  const metadata = hookRewriteApproval(original, effective)
  expect(permissionSearchView(approvalInput(metadata, original))).toEqual([
    "pattern: needle",
    "path: /private",
    "include: *.csv",
  ])
  expect(permissionRewriteView(metadata)).toEqual({
    changedFields: ["path", "include"],
    values: ['path: "/private"', 'include: "*.csv"'],
  })
})

test("the original and effective command cannot be mislabeled as identical", () => {
  const original = { command: "echo original", workdir: "/project" }
  const effective = { command: "echo replacement", workdir: "/different" }
  const metadata = hookRewriteApproval(original, effective)
  const data = approvalInput(metadata, original)
  expect(permissionCommandView(metadata, data)).toEqual({ command: "echo replacement" })
  expect(permissionRewriteView(metadata)).toEqual({
    changedFields: ["command", "workdir"],
    values: ['command: "echo replacement"', 'workdir: "/different"'],
  })
})

test("a password change is reported even when both audit values redact identically", () => {
  const before = { password: ["value", "one"].join("-") }
  const after = { password: ["value", "two"].join("-") }
  const metadata = hookRewriteApproval(before, after)
  expect(metadata.changedFields).toEqual(["password"])
  expect(permissionRewriteView(metadata)).toEqual({ changedFields: ["password"], values: ['password: "[redacted]"'] })
  expect(JSON.stringify(metadata)).not.toContain(before.password)
  expect(JSON.stringify(metadata)).not.toContain(after.password)
})

// Native FFI rendering is covered separately; pin the shared block's placement outside tool branches.
test("the approval body includes the generic rewrite block for every permission type", async () => {
  const source = await fs.readFile(
    new URL("../../../src/cli/tui/routes/session/permission.tsx", import.meta.url),
    "utf8",
  )
  const body = source.slice(source.indexOf("{permissionInfo().body}"), source.indexOf("options={baseOptions()}"))
  expect(body).toContain("<Show when={rewriteView()}>")
  expect(body).toContain('"Rewritten by hook: "')
  expect(body).toContain("rewrite().changedFields")
  expect(body).toContain("rewrite().values")
  expect(source).toContain("permissionSearchView(data)")
  expect(source).not.toContain('"Rewritten by hook: original "')
})
