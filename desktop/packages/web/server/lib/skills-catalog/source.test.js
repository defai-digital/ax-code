import { describe, expect, it } from "vitest"
import { parseSkillRepoSource } from "./source.js"

describe("parseSkillRepoSource", () => {
  it("parses shorthand sources with optional subpaths", () => {
    expect(parseSkillRepoSource("owner/repo/skills/review")).toEqual({
      ok: true,
      host: "github.com",
      owner: "owner",
      repo: "repo",
      cloneUrlSsh: "git@github.com:owner/repo.git",
      cloneUrlHttps: "https://github.com/owner/repo.git",
      effectiveSubpath: "skills/review",
      normalizedRepo: "owner/repo",
    })
  })

  it("lets explicit subpath override shorthand subpath", () => {
    expect(parseSkillRepoSource("owner/repo/ignored", { subpath: "selected" })).toMatchObject({
      ok: true,
      effectiveSubpath: "selected",
    })
  })

  it("trims repository input and string subpaths", () => {
    expect(parseSkillRepoSource(" owner/repo/ignored ", { subpath: " selected " })).toMatchObject({
      ok: true,
      owner: "owner",
      repo: "repo",
      effectiveSubpath: "selected",
    })
  })

  it("ignores non-string explicit subpaths", () => {
    expect(parseSkillRepoSource("owner/repo/fallback", { subpath: 123 })).toMatchObject({
      ok: true,
      effectiveSubpath: "fallback",
    })
  })

  it("parses HTTPS sources with nested owners", () => {
    expect(parseSkillRepoSource("https://gitlab.example.com/group/subgroup/repo.git")).toEqual({
      ok: true,
      host: "gitlab.example.com",
      owner: "group/subgroup",
      repo: "repo",
      cloneUrlSsh: "git@gitlab.example.com:group/subgroup/repo.git",
      cloneUrlHttps: "https://gitlab.example.com/group/subgroup/repo.git",
      effectiveSubpath: null,
      normalizedRepo: "group/subgroup/repo",
    })
  })

  it("parses SSH sources and accepts only explicit subpaths", () => {
    expect(parseSkillRepoSource("git@gitlab.example.com:group/subgroup/repo.git", { subpath: "skills" })).toMatchObject(
      {
        ok: true,
        host: "gitlab.example.com",
        owner: "group/subgroup",
        repo: "repo",
        effectiveSubpath: "skills",
      },
    )
  })

  it("parses SSH sources with bracketed IPv6 hosts", () => {
    expect(parseSkillRepoSource("git@[2001:db8::1]:group/repo.git")).toMatchObject({
      ok: true,
      host: "[2001:db8::1]",
      owner: "group",
      repo: "repo",
      cloneUrlSsh: "git@[2001:db8::1]:group/repo.git",
    })
  })

  it("rejects unsupported sources", () => {
    expect(parseSkillRepoSource("")).toMatchObject({ ok: false, error: { kind: "invalidSource" } })
    expect(parseSkillRepoSource("https://github.com/owner")).toMatchObject({
      ok: false,
      error: { kind: "invalidSource" },
    })
    expect(parseSkillRepoSource("not-a-repo")).toMatchObject({ ok: false, error: { kind: "invalidSource" } })
  })
})
