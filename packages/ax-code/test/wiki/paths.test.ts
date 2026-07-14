import { describe, expect, test } from "vitest"
import { sanitizeWikiDirRel, WIKI_DIR_DEFAULT } from "../../src/wiki"

describe("wiki/paths sanitizeWikiDirRel", () => {
  test("defaults empty and whitespace", () => {
    expect(sanitizeWikiDirRel()).toBe(WIKI_DIR_DEFAULT)
    expect(sanitizeWikiDirRel("")).toBe(WIKI_DIR_DEFAULT)
    expect(sanitizeWikiDirRel("   ")).toBe(WIKI_DIR_DEFAULT)
  })

  test("normalizes slashes and trailing segments", () => {
    expect(sanitizeWikiDirRel("docs\\\\wiki")).toBe("docs/wiki")
    expect(sanitizeWikiDirRel("./openwiki/")).toBe("openwiki")
    expect(sanitizeWikiDirRel("openwiki/en")).toBe("openwiki/en")
  })

  test("rejects absolute paths", () => {
    expect(sanitizeWikiDirRel("/etc/passwd")).toBe(WIKI_DIR_DEFAULT)
    expect(sanitizeWikiDirRel("C:/Windows")).toBe(WIKI_DIR_DEFAULT)
  })

  test("rejects parent traversal", () => {
    expect(sanitizeWikiDirRel("../secret")).toBe(WIKI_DIR_DEFAULT)
    expect(sanitizeWikiDirRel("openwiki/../../etc")).toBe(WIKI_DIR_DEFAULT)
    expect(sanitizeWikiDirRel("foo/../bar")).toBe(WIKI_DIR_DEFAULT)
  })
})
