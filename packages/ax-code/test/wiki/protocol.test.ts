import { describe, expect, test } from "vitest"
import { renderRepoWikiProtocol } from "../../src/wiki"

describe("wiki/protocol", () => {
  test("returns undefined when wiki missing", () => {
    expect(renderRepoWikiProtocol({ wikiExists: false })).toBeUndefined()
  })

  test("returns undefined when disabled", () => {
    expect(renderRepoWikiProtocol({ wikiExists: true, enabled: false })).toBeUndefined()
  })

  test("renders routing protocol when wiki exists", () => {
    const text = renderRepoWikiProtocol({
      wikiExists: true,
      wikiRel: "openwiki",
      indexRel: "openwiki/quickstart.md",
    })
    expect(text).toBeTruthy()
    expect(text).toContain("<repo_wiki>")
    expect(text).toContain("</repo_wiki>")
    expect(text).toContain("openwiki/quickstart.md")
    expect(text).toContain("code_intelligence")
    expect(text).toContain("trust the code")
  })
})
