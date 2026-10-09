import { expect, test } from "vitest"
import type { PermissionRequest } from "@ax-code/sdk/v2"
import {
  canSaveWebMcpApproval,
  webMcpAllowlistPreview,
  permissionOptionsStack,
} from "../../../src/cli/tui/component/webmcp-allowlist-model"

const request = {
  id: "perm_allowlist",
  sessionID: "ses_test",
  permission: "webmcp",
  patterns: ["bridge_list_pages"],
  always: [],
  metadata: {},
  webmcpAllowlist: { server: "bridge", project: "test", scope: { capability: "list_pages" } },
} as PermissionRequest

test("save is available only for eligible WebMCP requests and the staged request identity", () => {
  expect(canSaveWebMcpApproval(request)).toBe(true)
  expect(canSaveWebMcpApproval(request, request.id)).toBe(true)
  expect(canSaveWebMcpApproval(request, "perm_old")).toBe(false)
  expect(canSaveWebMcpApproval({ ...request, permission: "bash" })).toBe(false)
  expect(canSaveWebMcpApproval({ ...request, webmcpAllowlist: undefined })).toBe(false)
  expect(canSaveWebMcpApproval({ ...request, metadata: { requireInteractive: true } })).toBe(false)
})

test("listing preview names cross-origin scope; read and navigation name exact origins", () => {
  const listing = webMcpAllowlistPreview(request.webmcpAllowlist!).join("\n")
  expect(listing).toContain("multiple origins")
  expect(listing).toContain("does not approve navigation")
  for (const capability of ["read", "navigate"] as const) {
    const lines = webMcpAllowlistPreview({
      server: "bridge",
      project: "test",
      scope: { capability, origin: "https://example.test:8443" },
    }).join("\n")
    expect(lines).toContain("Origin: https://example.test:8443")
    expect(lines).toContain("Other origins and page actions")
  }
})

test("long options stack before overflowing and preview strips terminal controls", () => {
  expect(permissionOptionsStack(40, ["Allow once", "Add to WebMCP allowlist", "Reject"])).toBe(true)
  expect(permissionOptionsStack(120, ["Allow once", "Add to WebMCP allowlist", "Reject"])).toBe(false)
  expect(permissionOptionsStack(80, ["x".repeat(100)])).toBe(true)
  expect(
    webMcpAllowlistPreview({ ...request.webmcpAllowlist!, server: "bridge\u001b\u202e" }).join("\n"),
  ).not.toContain("\u001b")
})
