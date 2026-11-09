import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

test("styled chunk packing retains colors across GC and preserves links, UTF-8 and frozen inputs", () => {
  const structs = new URL("../src/core/zig-structs.ts", import.meta.url).href
  const rgba = new URL("../src/lib/rgba.ts", import.meta.url).href
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--expose-gc",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { StyledChunkStruct, CursorStyleOptionsStruct } from ${JSON.stringify(structs)}
import { RGBA } from ${JSON.stringify(rgba)}
const rgb = RGBA.fromHex("#12345678")
const indexed = RGBA.fromIndex(123)
const defaultColor = RGBA.defaultForeground()
const colors = [undefined, null, rgb, indexed, defaultColor, "#12345678"]
const links = [undefined, null, "", "https://example.com/中文", { url: "https://example.com/中文" }, { url: "" }]
const texts = ["", "ASCII", "中 café 👩‍💻\\n\\t", "a\\0b", "\\ud800"]
const chunks = []
for (const fg of colors) for (const bg of colors) for (const link of links) for (const text of texts) {
  chunks.push(Object.freeze({ text, fg, bg, link, attributes: 0xfedcba98 }))
}
const snapshots = chunks.map(chunk => ({ ...chunk }))
const buffers = [StyledChunkStruct.packList(chunks), ...chunks.slice(0, 12).map(chunk => StyledChunkStruct.pack(chunk))]
const cursor = CursorStyleOptionsStruct.pack({ color: RGBA.fromHex("#12345678") })
globalThis.gc()
const rows = StyledChunkStruct.unpackList(buffers[0], chunks.length)
const colorBytes = value => value == null ? undefined : [...(typeof value === "string" ? rgb : value).buffer]
for (let index = 0; index < chunks.length; index++) {
  const input = chunks[index]
  const output = rows[index]
  const url = typeof input.link === "string" ? input.link : input.link?.url
  assert.equal(output.text, input.text ? Buffer.from(input.text).toString() : null)
  assert.equal(BigInt(output.text_len), BigInt(Buffer.byteLength(input.text)))
  assert.deepEqual(output.fg && [...output.fg.buffer], colorBytes(input.fg))
  assert.deepEqual(output.bg && [...output.bg.buffer], colorBytes(input.bg))
  assert.equal(output.attributes, input.attributes)
  assert.equal(output.link, url || null)
  assert.equal(BigInt(output.link_len), BigInt(Buffer.byteLength(url ?? "")))
  assert.deepEqual(input, snapshots[index], "Packing mutated its input")
}
for (let index = 0; index < 12; index++) {
  assert.deepEqual(StyledChunkStruct.unpack(buffers[index + 1]), rows[index])
}
const target = new DataView(new ArrayBuffer(StyledChunkStruct.size * 2))
const last = chunks.at(-1)
StyledChunkStruct.packInto(last, target, StyledChunkStruct.size)
assert.deepEqual(StyledChunkStruct.unpack(target.buffer.slice(StyledChunkStruct.size)), rows.at(-1))
assert.deepEqual([...new Uint8Array(target.buffer, 0, StyledChunkStruct.size)], Array(StyledChunkStruct.size).fill(0))
assert.equal(StyledChunkStruct.packList([]).byteLength, 0)
assert.deepEqual([...CursorStyleOptionsStruct.unpack(cursor).color.buffer], [...rgb.buffer])
process.stdout.write("AX_STYLED_CHUNK_PACKING_COMPLETE")
`,
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    },
  )
  expect(child.error, child.stderr).toBeUndefined()
  expect(child.status, child.stdout + child.stderr).toBe(0)
  expect(child.stdout).toContain("AX_STYLED_CHUNK_PACKING_COMPLETE")
})
