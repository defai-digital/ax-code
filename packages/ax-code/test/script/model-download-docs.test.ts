import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import {
  renderModelDownloads,
  refreshModelDownloads,
  ModelMirrorInventory,
  ModelDownloadSnapshot,
} from "../../script/model-download-docs"

const repo = "AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP"
const revision = "a".repeat(40)
const snapshot: ModelDownloadSnapshot = {
  version: 1,
  checkedAt: "2026-10-19T00:00:00.000Z",
  models: [{ repo, revision, private: false, gated: false, license: "apache-2.0" }],
}
const mirror = {
  repo,
  revision,
  manifestUrl: "https://download.ax-code.com/models/manifest.json",
  signatureUrl: "https://download.ax-code.com/models/manifest.json.minisig",
  verificationReceipt: "https://download.ax-code.com/models/receipt.json",
  manifestSha256: "b".repeat(64),
  verifiedAt: snapshot.checkedAt,
}

afterEach(() => vi.unstubAllGlobals())

test("selected collection models show exact HF revisions and honest missing mirror status", () => {
  const page = renderModelDownloads(snapshot, { version: 1, mirrors: [] })
  expect(page).toContain(`https://huggingface.co/${repo}/tree/${revision}`)
  expect(page).toContain("| Selected |")
  expect(page).toContain("Not published")
  expect(page).toContain("https://models.ax-code.app/")
  expect(page).toContain("ax-code providers ax-engine prepare --model-path <dir>")
  expect(page).not.toContain("https://download.ax-code.com/models/")
})

test("a mirror cannot be advertised for a different source revision", () => {
  const page = renderModelDownloads(snapshot, { version: 1, mirrors: [{ ...mirror, revision: "c".repeat(40) }] })
  expect(page).toContain("No verified mirror for this revision")
  expect(page).not.toContain(mirror.manifestUrl)
  expect(renderModelDownloads(snapshot, { version: 1, mirrors: [mirror] })).toContain(mirror.verificationReceipt)
})

test("new collection models remain pending runtime admission and cannot inject Markdown", () => {
  const page = renderModelDownloads(
    { ...snapshot, models: [{ ...snapshot.models[0]!, repo: "AutomatosX/New-Model", license: "other|<script>" }] },
    { version: 1, mirrors: [] },
  )
  expect(page).toContain("Pending review")
  expect(page).not.toContain("<script>")
  expect(page).not.toContain("other|")
})

test.each([
  "https://third-party.example/file",
  "https://user:password@download.ax-code.com/file",
  "https://download.ax-code.com/file?token=secret",
  "http://download.ax-code.com/file",
  "https://download.ax-code.com:8443/file",
  "https://download.ax-code.com/file)bad",
])("mirror inventory rejects untrusted or credential-bearing links: %s", (manifestUrl) => {
  expect(() => ModelMirrorInventory.parse({ version: 1, mirrors: [{ ...mirror, manifestUrl }] })).toThrow()
})

test("duplicate identities and private or gated public-mirror claims fail closed", () => {
  expect(() =>
    renderModelDownloads(
      { ...snapshot, models: [...snapshot.models, ...snapshot.models] },
      { version: 1, mirrors: [] },
    ),
  ).toThrow("Duplicate")
  expect(() => renderModelDownloads(snapshot, { version: 1, mirrors: [mirror, mirror] })).toThrow("Duplicate")
  expect(() =>
    renderModelDownloads(
      { ...snapshot, models: [{ ...snapshot.models[0]!, gated: "manual" }] },
      { version: 1, mirrors: [mirror] },
    ),
  ).toThrow("gated")
})

test("a failed or incomplete refresh preserves the previous observation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ items: [] }))),
  )
  await expect(refreshModelDownloads(snapshot)).rejects.toThrow("Empty")
  expect(snapshot.models[0]!.revision).toBe(revision)
})

test("unchanged publisher metadata does not create daily timestamp churn", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/collections/")
              ? { items: [{ type: "model", id: repo }] }
              : { id: repo, sha: revision, private: false, gated: false, cardData: { license: "apache-2.0" } },
          ),
        ),
    ),
  )
  expect(await refreshModelDownloads(snapshot)).toEqual(snapshot)
})

test("the checked-in download page is deterministic from its public inventories", async () => {
  const root = new URL("../../../../", import.meta.url)
  const observed = JSON.parse(await fs.readFile(new URL("docs/data/ax-code-model-downloads.json", root), "utf8"))
  const mirrors = JSON.parse(await fs.readFile(new URL("docs/data/ax-code-model-mirrors.json", root), "utf8"))
  const page = await fs.readFile(new URL("docs/providers/ax-code-model-downloads.md", root), "utf8")
  expect(renderModelDownloads(observed, mirrors)).toBe(page)
})

test("a paginated observation cannot silently replace the complete inventory", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [{ type: "model", id: repo }] }), {
          headers: { link: '<https://huggingface.co/next>; rel="next"' },
        }),
    ),
  )
  await expect(refreshModelDownloads(snapshot)).rejects.toThrow("Paginated")
})

test.each([
  ["2026-10-24T12:34Z", true],
  ["2026-10-24T12:34:56Z", true],
  ["2026-02-29T12:34Z", false],
  ["2026-10-24T12:34+01:00", false],
])("preserves model observation timestamp acceptance for %s", (value, accepted) => {
  expect(ModelDownloadSnapshot.shape.checkedAt.safeParse(value).success).toBe(accepted)
  expect(ModelMirrorInventory.safeParse({ version: 1, mirrors: [{ ...mirror, verifiedAt: value }] }).success).toBe(
    accepted,
  )
})
