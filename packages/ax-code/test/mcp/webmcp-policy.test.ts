import { describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Config } from "../../src/config/config"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const origins = ["https://example.test", "https://other.test"]
const profile = () => WebMcpProfile.config({ allowedOrigins: origins }, true).webmcp

describe("WebMCP managed requirement", () => {
  test("schema admits allow and exact origins only", () => {
    expect(Config.Info.safeParse({ webmcp: {} }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allow: false } }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allow: true, allowedOrigins: origins } }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allowedOrigins: ["*"] } }).success).toBe(false)
    expect(Config.Info.safeParse({ webmcp: { allowedOrigins: [] } }).success).toBe(false)
    expect(Config.Info.safeParse({ webmcp: { allow: "no" } }).success).toBe(false)
    expect(Config.Info.safeParse({ webmcp: { extra: true } }).success).toBe(false)
  })

  test("an absent requirement leaves the profile untouched", () => {
    const current = profile()
    expect(WebMcpProfile.applyRequirement(undefined, current)).toBe(current)
    expect(WebMcpProfile.applyRequirement({ allow: true }, current)).toBe(current)
  })

  test("a managed deny fails closed", () => {
    expect(() => WebMcpProfile.applyRequirement({ allow: false }, profile())).toThrow("disabled by managed policy")
  })

  test("evaluate reports denial reasons without throwing", () => {
    const current = profile()
    expect(WebMcpProfile.evaluate(undefined, current)).toEqual({ ok: true, profile: current })
    expect(WebMcpProfile.evaluate({ allow: false }, current)).toEqual({ ok: false, reason: "managed_policy" })
    expect(WebMcpProfile.evaluate({ allowedOrigins: ["https://unlisted.test"] }, current)).toEqual({
      ok: false,
      reason: "managed_origins",
    })
    const decision = WebMcpProfile.evaluate({ allow: true, allowedOrigins: ["https://other.test"] }, current)
    expect(decision.ok && decision.profile.allowedOrigins).toEqual(["https://other.test"])
  })

  test("a managed origin list narrows to the intersection", () => {
    const narrowed = WebMcpProfile.applyRequirement(
      { allow: true, allowedOrigins: ["https://example.test", "https://unlisted.test"] },
      profile(),
    )
    expect(narrowed.allowedOrigins).toEqual(["https://example.test"])
    expect(Object.isFrozen(narrowed.allowedOrigins)).toBe(true)
    expect(() => WebMcpProfile.validateCall(narrowed, "new_page", { url: "https://other.test/" })).toThrow(
      "origin is not allowed",
    )
    expect(() => WebMcpProfile.validateCall(narrowed, "new_page", { url: "https://example.test/" })).not.toThrow()
  })

  test("a managed origin list with no overlap fails closed", () => {
    expect(() => WebMcpProfile.applyRequirement({ allowedOrigins: ["https://unlisted.test"] }, profile())).toThrow(
      "excludes every origin",
    )
  })

  test("narrowing never rewrites the launch argv, which stays validated against the full profile", () => {
    const config = WebMcpProfile.config({ allowedOrigins: origins }, true)
    const validated = WebMcpProfile.validateLaunch(config)!
    const effective = WebMcpProfile.applyRequirement({ allowedOrigins: ["https://example.test"] }, validated)
    expect(effective.allowedOrigins).toEqual(["https://example.test"])
    expect(WebMcpProfile.validateLaunch(config)).toEqual(validated)
  })

  test("parses the bridge's structured listing and page text", () => {
    const pages = WebMcpProfile.parsePages("## Pages\n1: about:blank\n2: Home (https://example.test/) [selected]")
    expect(pages.get(1)).toBe("about:blank")
    expect(pages.get(2)).toBe("https://example.test/")

    const listing = WebMcpProfile.parseToolListing({
      structuredContent: {
        webmcpTools: [
          {
            name: "a",
            description: "d",
            inputSchema: { type: "object" },
            annotations: { readOnly: true, consequential: true },
          },
        ],
      },
    })
    expect(listing).toHaveLength(1)
    expect(listing?.[0]?.annotations).toEqual({ readOnly: true, untrustedContent: false, consequential: true })
    expect(WebMcpProfile.parseToolListing({})).toBeUndefined()
  })

  test("descriptor caps fail closed", () => {
    const state = WebMcpProfile.stateFor(profile())
    const many = Array.from({ length: WebMcpProfile.MAX_TOOLS + 1 }, (_, i) => ({ name: `t${i}` }))
    expect(WebMcpProfile.recordListing(state, 1, many)).toMatchObject({ ok: false })
    expect(
      WebMcpProfile.recordListing(state, 2, [
        { name: "a", description: "x".repeat(WebMcpProfile.MAX_DESCRIPTOR_BYTES) },
      ]),
    ).toMatchObject({ ok: false })
  })

  test("definition churn past the cap disables the page", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    for (let i = 0; i <= WebMcpProfile.MAX_REGISTRATION_CHANGES; i++) {
      expect(
        WebMcpProfile.recordListing(state, 1, [{ name: "a", description: `v${i}` }], "https://example.test/"),
      ).toEqual({ ok: true })
    }
    // The eleventh change past the baseline disables the page.
    expect(
      WebMcpProfile.recordListing(state, 1, [{ name: "a", description: "v11" }], "https://example.test/"),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("too many times"),
    })
    // Even the matching fresh descriptor no longer binds once disabled.
    expect(
      WebMcpProfile.verifyBinding(current, 1, "a", [{ name: "a", description: "v11" }], "https://example.test/"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("disabled") })
  })

  test("verifyBinding matches the listed descriptor and rejects drift", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "search", description: "d", inputSchema: { type: "object" } }
    expect(WebMcpProfile.recordListing(state, 5, [descriptor], "https://example.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.verifyBinding(current, 5, "search", [descriptor], "https://example.test/page")).toEqual({
      ok: true,
    })
    expect(
      WebMcpProfile.verifyBinding(
        current,
        5,
        "search",
        [{ ...descriptor, description: "changed" }],
        "https://example.test/page",
      ),
    ).toMatchObject({ ok: false })
    expect(WebMcpProfile.verifyBinding(current, 5, "search", [descriptor], "https://evil.test/page")).toMatchObject({
      ok: false,
    })
    expect(WebMcpProfile.verifyBinding(current, 5, "search", [descriptor])).toMatchObject({ ok: false })
  })

  test("parsePages reads the bridge address, not a forged title URL", () => {
    const pages = WebMcpProfile.parsePages(
      "## Pages\n1: https://example.test/ (https://evil.test/) [selected]\n2: Pwned (https://example.test/) (https://other.test/)",
    )
    expect(pages.get(1)).toBe("https://evil.test/")
    expect(pages.get(2)).toBe("https://other.test/")
  })

  test("parsePages keeps IPv6 loopback addresses and skips unsafe or repeated ids", () => {
    const pages = WebMcpProfile.parsePages(
      "## Pages\n1: App (http://[::1]:3000/)\n9007199254740993: Big (https://example.test/)\n1: Dup (https://other.test/)",
    )
    expect(pages.get(1)).toBe("http://[::1]:3000/")
    expect(pages.has(9007199254740992)).toBe(false)
    expect(pages.size).toBe(1)
  })

  test("duplicate tool names fail closed in both listing paths", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const dupes = [
      { name: "a", description: "first" },
      { name: "a", description: "last" },
    ]
    expect(WebMcpProfile.recordListing(state, 1, dupes, "https://example.test/")).toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate"),
    })
    expect(
      WebMcpProfile.recordListing(state, 2, [{ name: "a", description: "only" }], "https://example.test/"),
    ).toEqual({ ok: true })
    expect(WebMcpProfile.verifyBinding(current, 2, "a", dupes, "https://example.test/")).toMatchObject({
      ok: false,
      error: expect.stringContaining("duplicate"),
    })
  })

  test("a failed listing invalidates the stored baseline", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    const many = Array.from({ length: WebMcpProfile.MAX_TOOLS + 1 }, (_, i) => ({ name: `t${i}` }))
    expect(WebMcpProfile.recordListing(state, 1, many, "https://example.test/")).toMatchObject({ ok: false })
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [descriptor], "https://example.test/")).toMatchObject({
      ok: false,
      error: expect.stringContaining("called first"),
    })
  })

  test("verifyBinding enforces the listing caps on the fresh re-listing", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    const fresh = [descriptor, ...Array.from({ length: WebMcpProfile.MAX_TOOLS }, (_, i) => ({ name: `t${i}` }))]
    expect(WebMcpProfile.verifyBinding(current, 1, "a", fresh, "https://example.test/")).toMatchObject({
      ok: false,
      error: expect.stringContaining("too many tools"),
    })
  })

  test("a persistent profile requires the managed opt-in", () => {
    const persistent = WebMcpProfile.config({ allowedOrigins: ["https://example.test"], persistentProfile: true }, true)
    expect(WebMcpProfile.evaluate(undefined, persistent.webmcp)).toEqual({ ok: false, reason: "persistent_profile" })
    expect(WebMcpProfile.evaluate({ allowPersistentProfile: true }, persistent.webmcp)).toMatchObject({ ok: true })
    expect(WebMcpProfile.evaluate({ allow: false }, persistent.webmcp)).toEqual({ ok: false, reason: "managed_policy" })
  })

  test("a persistent profile uses a dedicated user-data-dir with a visible window", () => {
    const config = WebMcpProfile.config(
      { allowedOrigins: ["https://example.test"], persistentProfile: true, headless: true },
      true,
    )
    expect(config.command.some((arg) => arg.startsWith("--user-data-dir="))).toBe(true)
    expect(config.command).not.toContain("--isolated")
    expect(config.command).not.toContain("--headless")
    expect(WebMcpProfile.validateLaunch(config)).toEqual(config.webmcp)
  })

  test("schema admits the vendored opt-ins", () => {
    expect(Config.Info.safeParse({ webmcp: { allowVendored: true } }).success).toBe(true)
    expect(Config.Info.safeParse({ webmcp: { allowVendored: "yes" } }).success).toBe(false)
    const config = WebMcpProfile.config({ allowedOrigins: ["https://example.test"], vendored: true }, true)
    expect(config.webmcp?.vendored).toBe(true)
  })

  test("a vendored install requires the managed opt-in", () => {
    const vendored = WebMcpProfile.config({ allowedOrigins: ["https://example.test"], vendored: true }, true)
    expect(WebMcpProfile.evaluate(undefined, vendored.webmcp)).toEqual({ ok: false, reason: "vendored" })
    expect(WebMcpProfile.evaluate({}, vendored.webmcp)).toEqual({ ok: false, reason: "vendored" })
    expect(WebMcpProfile.evaluate({ allowVendored: true }, vendored.webmcp)).toMatchObject({ ok: true })
    expect(WebMcpProfile.evaluate({ allow: false, allowVendored: true }, vendored.webmcp)).toEqual({
      ok: false,
      reason: "managed_policy",
    })
  })

  test("a vendored profile launches the pinned local install instead of npx", () => {
    const config = WebMcpProfile.config({ allowedOrigins: ["https://example.test"], vendored: true }, true)
    expect(config.command.slice(0, 2)).toEqual(["node", WebMcpProfile.vendoredBin()])
    expect(config.command).not.toContain("npx")
    expect(config.command).not.toContain(WebMcpProfile.PACKAGE)
    expect(WebMcpProfile.validateLaunch(config)).toEqual(config.webmcp)
    const plain = WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true)
    expect(plain.command.slice(0, 3)).toEqual(["npx", "-y", WebMcpProfile.PACKAGE])
  })

  test("verifyLockfileIntegrity enforces the reviewed pin", () => {
    const lock = (entry: unknown) => JSON.stringify({ packages: { "node_modules/chrome-devtools-mcp": entry } })
    const good = {
      integrity: WebMcpProfile.VENDORED_INTEGRITY,
      version: "1.8.0",
      resolved: "https://registry.npmjs.org/chrome-devtools-mcp/-/chrome-devtools-mcp-1.8.0.tgz",
    }
    expect(WebMcpProfile.verifyLockfileIntegrity(lock(good))).toEqual({ ok: true })
    expect(WebMcpProfile.verifyLockfileIntegrity(lock({ ...good, integrity: "sha512-forged" }))).toMatchObject({
      ok: false,
    })
    expect(WebMcpProfile.verifyLockfileIntegrity(lock({ ...good, version: "1.8.1" }))).toMatchObject({ ok: false })
    expect(
      WebMcpProfile.verifyLockfileIntegrity(lock({ ...good, resolved: "https://mirror.test/pkg.tgz" })),
    ).toMatchObject({ ok: false })
    expect(WebMcpProfile.verifyLockfileIntegrity(lock({ ...good, resolved: undefined }))).toMatchObject({ ok: false })
    expect(WebMcpProfile.verifyLockfileIntegrity(JSON.stringify({ packages: {} }))).toMatchObject({ ok: false })
    expect(WebMcpProfile.verifyLockfileIntegrity("not json")).toMatchObject({ ok: false })
  })

  test("verifyBinding pins execution to the listing-time origin", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    // Same allowlist, mirrored tool, different origin: still rejected.
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [descriptor], "https://other.test/")).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed since its tools were listed"),
    })
    expect(WebMcpProfile.listedOriginFor(current, 1)).toBe("https://example.test")
    expect(WebMcpProfile.listedOriginFor(current, 2)).toBeUndefined()
  })

  test("a navigation counts as a page change for churn tracking", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    // Same tools, new origin: the baseline moves without disabling the page.
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://other.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.listedOriginFor(current, 1)).toBe("https://other.test")
  })

  test("an annotation flip breaks the descriptor binding", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d", annotations: { readOnly: true } }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    expect(
      WebMcpProfile.verifyBinding(
        current,
        1,
        "a",
        [{ ...descriptor, annotations: { consequential: true } }],
        "https://example.test/",
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("changed since it was listed") })
  })

  test("an unlocatable page names the browser error page or the missing tab", () => {
    expect(WebMcpProfile.unlocatedPageMessage("chrome-error://chromewebdata/", "could not be located")).toContain(
      "browser error page",
    )
    expect(WebMcpProfile.unlocatedPageMessage(undefined, "could not be located")).toContain(
      "not in the bridge page list",
    )
    expect(WebMcpProfile.unlocatedPageMessage("about:blank", "could not be located")).toContain("non-web address")
  })

  test("a blocking dialog in a bridge result is flagged for the model", () => {
    const result = {
      content: [
        { type: "text", text: "Navigated.\n# Open dialog\nconfirm: Allow ads?\nCall handle_dialog to handle it." },
      ],
    }
    WebMcpProfile.annotateBlockingDialog(result)
    expect(result.content).toHaveLength(2)
    expect(result.content[1].text).toContain("blocked by a JavaScript dialog")
    const clean = { content: [{ type: "text", text: "## Pages\n1: about:blank" }] }
    WebMcpProfile.annotateBlockingDialog(clean)
    expect(clean.content).toHaveLength(1)
  })

  test("a listing without a locatable page fails and clears the baseline", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], undefined)).toMatchObject({
      ok: false,
      error: expect.stringContaining("could not be located"),
    })
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [descriptor], "https://example.test/")).toMatchObject({
      ok: false,
      error: expect.stringContaining("called first"),
    })
  })

  test("parses structured pages from the browser target, skipping malformed entries", () => {
    const pages = WebMcpProfile.parseStructuredPages({
      structuredContent: {
        pages: [
          { id: 1, url: "https://example.test/", title: "App", selected: true },
          { id: 2, url: "http://[::1]:3000/", title: "Local" },
          { id: "x", url: "https://bad.test/" },
          { id: 3 },
          { id: 2, url: "https://dupe.test/" },
        ],
      },
    })
    expect(pages?.get(1)).toBe("https://example.test/")
    expect(pages?.get(2)).toBe("http://[::1]:3000/")
    expect(pages?.size).toBe(2)
    expect(WebMcpProfile.parseStructuredPages({ content: [] })).toBeUndefined()
    expect(WebMcpProfile.parseStructuredPages({ structuredContent: {} })).toBeUndefined()
  })

  test("validateLanding checks the landed origin, not the requested URL", () => {
    const current = profile()
    const landed = (url: string, selected = true) => ({
      structuredContent: { pages: [{ id: 1, url, title: "t", selected }] },
    })
    expect(() =>
      WebMcpProfile.validateLanding(
        current,
        "new_page",
        { url: "https://example.test/" },
        landed("https://evil.test/"),
      ),
    ).toThrow("did not land on an allowed origin")
    expect(() =>
      WebMcpProfile.validateLanding(
        current,
        "new_page",
        { url: "https://example.test/" },
        landed("https://example.test/welcome"),
      ),
    ).not.toThrow()
    expect(() =>
      WebMcpProfile.validateLanding(current, "navigate_page", { pageId: 1 }, landed("https://evil.test/")),
    ).toThrow("did not land on an allowed origin")
    expect(() =>
      WebMcpProfile.validateLanding(current, "navigate_page", { pageId: 2 }, landed("https://example.test/")),
    ).toThrow("could not be verified")
    expect(() => WebMcpProfile.validateLanding(current, "navigate_page", { pageId: 1 }, { content: [] })).toThrow(
      "could not be verified",
    )
    expect(() => WebMcpProfile.validateLanding(current, "close_page", { pageId: 1 }, { content: [] })).not.toThrow()
  })

  test("an approval snapshot pins execution to what the approver saw", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const v1 = { name: "a", description: "v1" }
    expect(WebMcpProfile.recordListing(state, 1, [v1], "https://example.test/")).toEqual({ ok: true })
    const snapshot = WebMcpProfile.captureApproval(current, 1, "a")
    expect(snapshot).toBeDefined()
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [v1], "https://example.test/", snapshot)).toEqual({
      ok: true,
    })
    // A post-approval rewrite fails closed even though the live baseline matches fresh.
    const v2 = { name: "a", description: "v2" }
    expect(WebMcpProfile.recordListing(state, 1, [v2], "https://example.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [v2], "https://example.test/", snapshot)).toMatchObject({
      ok: false,
      error: expect.stringContaining("since approval"),
    })
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [v2], "https://example.test/")).toEqual({ ok: true })
  })

  test("an approval snapshot pins the origin across same-allowlist navigation", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    const snapshot = WebMcpProfile.captureApproval(current, 1, "a")
    expect(snapshot).toMatchObject({ origin: "https://example.test" })
    // The page moves to another allowed origin and re-lists the same tool.
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://other.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.verifyBinding(current, 1, "a", [descriptor], "https://other.test/", snapshot)).toMatchObject({
      ok: false,
      error: expect.stringContaining("since approval"),
    })
  })

  test("verifyBinding rejects a snapshot captured for another call", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    const descriptor = { name: "a", description: "d" }
    expect(WebMcpProfile.recordListing(state, 1, [descriptor], "https://example.test/")).toEqual({ ok: true })
    const snapshot = WebMcpProfile.captureApproval(current, 1, "a")
    expect(snapshot).toMatchObject({ pageId: 1, toolName: "a" })
    expect(WebMcpProfile.verifyBinding(current, 2, "a", [descriptor], "https://example.test/", snapshot)).toMatchObject(
      {
        ok: false,
        error: expect.stringContaining("does not match"),
      },
    )
    expect(WebMcpProfile.verifyBinding(current, 1, "b", [descriptor], "https://example.test/", snapshot)).toMatchObject(
      {
        ok: false,
        error: expect.stringContaining("does not match"),
      },
    )
  })

  test("captureApproval is undefined without a usable listing", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    expect(WebMcpProfile.captureApproval(current, 1, "missing")).toBeUndefined()
    expect(WebMcpProfile.recordListing(state, 1, [{ name: "a" }], "https://example.test/")).toEqual({ ok: true })
    expect(WebMcpProfile.captureApproval(current, 1, "other")).toBeUndefined()
    WebMcpProfile.invalidateListing(current, 1)
    expect(WebMcpProfile.captureApproval(current, 1, "a")).toBeUndefined()
  })

  test("approval snapshots ride on the validated call object", () => {
    const current = profile()
    const state = WebMcpProfile.stateFor(current)
    expect(WebMcpProfile.recordListing(state, 1, [{ name: "a" }], "https://example.test/")).toEqual({ ok: true })
    const call = WebMcpProfile.validateCall(current, "execute_webmcp_tool", { pageId: 1, toolName: "a", input: "{}" })
    const snapshot = WebMcpProfile.captureApproval(current, 1, "a")
    expect(snapshot).toBeDefined()
    WebMcpProfile.bindApproval(call, snapshot!)
    expect(WebMcpProfile.approvalFor(call)).toBe(snapshot)
    expect(WebMcpProfile.approvalFor({ pageId: 1 })).toBeUndefined()
    expect(WebMcpProfile.approvalFor(undefined)).toBeUndefined()
    const denied = { pageId: 1, toolName: "a" }
    expect(WebMcpProfile.approvalDenied(denied)).toBe(false)
    WebMcpProfile.denyApproval(denied)
    expect(WebMcpProfile.approvalDenied(denied)).toBe(true)
    expect(WebMcpProfile.approvalDenied(call)).toBe(false)
    expect(WebMcpProfile.approvalDenied(undefined)).toBe(false)
  })

  test("verifyVendoredPackage re-hashes the extracted bytes, skipping dotfiles", () => {
    // Golden rollup over a.txt ("a") and sub/b.txt ("bb"); the dotfile is skipped.
    const golden =
      "6aab9f4f7f431153571ea80a4f43d974bd460a38f351652837654c492bfb7776018c353c5240bfd7382029ca8fec171e754a32a3b372579b0a8bc3d97f417b79"
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-bytes-"))
    try {
      const root = path.join(prefix, "node_modules", "chrome-devtools-mcp")
      fs.mkdirSync(path.join(root, "sub"), { recursive: true })
      fs.writeFileSync(path.join(root, "a.txt"), "a")
      fs.writeFileSync(path.join(root, "sub", "b.txt"), "bb")
      fs.writeFileSync(path.join(root, ".droppings"), "x")
      expect(WebMcpProfile.verifyVendoredPackage(prefix, golden)).toEqual({ ok: true })
      // A modified byte fails even though the file list is unchanged.
      fs.writeFileSync(path.join(root, "sub", "b.txt"), "bb-tampered")
      expect(WebMcpProfile.verifyVendoredPackage(prefix, golden)).toMatchObject({ ok: false })
      fs.writeFileSync(path.join(root, "sub", "b.txt"), "bb")
      // An extra file fails even though every reviewed file is intact.
      fs.writeFileSync(path.join(root, "planted.js"), "evil")
      expect(WebMcpProfile.verifyVendoredPackage(prefix, golden)).toMatchObject({ ok: false })
      fs.rmSync(path.join(root, "planted.js"))
      // Symlinks fail closed instead of being followed.
      fs.symlinkSync(path.join(root, "a.txt"), path.join(root, "link.txt"))
      expect(WebMcpProfile.verifyVendoredPackage(prefix, golden)).toMatchObject({ ok: false })
    } finally {
      fs.rmSync(prefix, { recursive: true, force: true })
    }
    expect(WebMcpProfile.verifyVendoredPackage(path.join(prefix, "missing"), golden)).toMatchObject({ ok: false })
  })
})
