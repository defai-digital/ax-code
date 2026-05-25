import { expect, test } from "bun:test"
import {
  decodeGitQuotedPath,
  parseLsTreeSize,
  parseNameStatusLine,
  parseNumstatLine,
  parsePathLine,
} from "../../src/util/git-output"

test("decodeGitQuotedPath decodes only valid JSON string paths", () => {
  expect(decodeGitQuotedPath("src/index.ts")).toBe("src/index.ts")
  expect(decodeGitQuotedPath('"dir/file\\tname.ts"')).toBe("dir/file\tname.ts")
  expect(decodeGitQuotedPath('"unterminated')).toBe('"unterminated')
  expect(decodeGitQuotedPath('{"path":"src/index.ts"}')).toBe('{"path":"src/index.ts"}')
})

test("parsePathLine decodes single git-quoted paths", () => {
  expect(parsePathLine("src/index.ts")).toBe("src/index.ts")
  expect(parsePathLine('"dir/file\\tname.ts"')).toBe("dir/file\tname.ts")
  expect(parsePathLine("")).toBeUndefined()
})

test("parseNameStatusLine decodes git-quoted paths", () => {
  expect(parseNameStatusLine("M\tsrc/index.ts")).toEqual({
    code: "M",
    file: "src/index.ts",
  })
  expect(parseNameStatusLine('A\t"path\\\\with\\\\tabs\\tfile.ts"')).toEqual({
    code: "A",
    file: "path\\with\\tabs\tfile.ts",
  })
  expect(parseNameStatusLine("missing-tab")).toBeUndefined()
})

test("parseNumstatLine normalizes text and binary entries", () => {
  expect(parseNumstatLine("12\t3\tsrc/index.ts")).toEqual({
    file: "src/index.ts",
    additions: 12,
    deletions: 3,
    binary: false,
  })
  expect(parseNumstatLine("-\t-\timage.png")).toEqual({
    file: "image.png",
    additions: 0,
    deletions: 0,
    binary: true,
  })
  expect(parseNumstatLine('1\t0\t"dir/file\\nname.ts"')).toEqual({
    file: "dir/file\nname.ts",
    additions: 1,
    deletions: 0,
    binary: false,
  })
  expect(parseNumstatLine("missing-tab")).toBeUndefined()
})

test("parseLsTreeSize reads file sizes from ls-tree metadata", () => {
  expect(parseLsTreeSize("100644 blob 1111111111111111111111111111111111111111 42\tsrc/index.ts")).toBe(42)
  expect(parseLsTreeSize("100644 blob 1111111111111111111111111111111111111111 -\timage.png")).toBeUndefined()
  expect(parseLsTreeSize("malformed")).toBeUndefined()
})
