import { expect, test } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"

test("cancelPending rejects a pending oauth flow by MCP name", async () => {
  const pending = McpOAuthCallback.waitForCallback("state-test", "github")
  McpOAuthCallback.cancelPending("github")
  await expect(pending).rejects.toThrow("Authorization cancelled")
})
