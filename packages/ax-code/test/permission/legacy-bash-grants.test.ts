import { describe, expect, test } from "vitest"
import { Permission } from "../../src/permission"

// 2026-09-14: BashArity.prefix used to count flag tokens as subcommands, so
// "always" grants for flag-prefixed commands persisted patterns whose fixed
// prefix ends at a flag (e.g. `git --no-pager *`), auto-approving every later
// subcommand behind that flag. The generator is fixed; previously saved rules
// keep the over-broad shape and are surfaced for review, never rewritten
// automatically (hand-written rules are indistinguishable).
describe("Permission.legacyBashFlagGrants", () => {
  const rule = (pattern: string, permission = "bash") => ({ permission, pattern, action: "allow" as const })

  test("flags a flag-terminated bash allow pattern", () => {
    const legacy = rule("git --no-pager *")
    expect(Permission.legacyBashFlagGrants([legacy])).toEqual([legacy])
    expect(Permission.legacyBashFlagGrants([rule("docker -H *")])).toHaveLength(1)
    expect(Permission.legacyBashFlagGrants([rule("python -c *")])).toHaveLength(1)
  })

  test("value-terminated legacy shapes are a documented detection gap", () => {
    // `aws --profile prod *` was also produced by the old generator, but the
    // fixed prefix ends on a flag VALUE, not a flag. A rule cannot be flagged
    // on that shape without also flagging the legitimate post-fix pattern
    // `git --no-pager log *`. Surfacing stays precise (zero false positives);
    // the gap is documented in the bug report for manual /permissions review.
    expect(Permission.legacyBashFlagGrants([rule("aws --profile prod *")])).toEqual([])
  })

  test("the degenerate empty-prefix pattern is legacy too", () => {
    expect(Permission.legacyBashFlagGrants([rule(" *")])).toHaveLength(1)
  })

  test("post-fix patterns ending on a subcommand are not flagged", () => {
    expect(Permission.legacyBashFlagGrants([rule("git --no-pager log *")])).toEqual([])
    expect(Permission.legacyBashFlagGrants([rule("git checkout *")])).toEqual([])
    expect(Permission.legacyBashFlagGrants([rule("aws --profile prod s3 *")])).toEqual([])
  })

  test("non-bash and non-allow rules are ignored", () => {
    expect(
      Permission.legacyBashFlagGrants([{ permission: "read", pattern: "git --no-pager *", action: "allow" }]),
    ).toEqual([])
    expect(
      Permission.legacyBashFlagGrants([{ permission: "bash", pattern: "git --no-pager *", action: "deny" }]),
    ).toEqual([])
    expect(
      Permission.legacyBashFlagGrants([{ permission: "bash", pattern: "git --no-pager *", action: "ask" }]),
    ).toEqual([])
  })

  test("patterns without the trailing wildcard are left alone", () => {
    expect(Permission.legacyBashFlagGrants([rule("git --no-pager")])).toEqual([])
    expect(Permission.legacyBashFlagGrants([rule("*")])).toEqual([])
  })
})
