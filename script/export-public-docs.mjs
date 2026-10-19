import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { resolve, relative, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const websiteOrigin = "https://ax-code.app"
const downloadOrigin = "https://download.ax-code.com"
const docUrl = (slug) => `/en/docs/${slug ? `${slug}/` : ""}`
const hash = (data) => createHash("sha256").update(data).digest("hex")

export function assertPublicSource(name) {
  const explicitlyPublic = new Set([
    "LICENSE",
    "LICENSE-MIT",
    "NOTICE",
    "SECURITY.md",
    "packages/sdk/js/README.md",
    "packages/sdk/openapi.json",
    "packages/sdk/proto/ax_code/v1/headless.proto",
    "packages/sdk/js/example/headless-app.ts",
    "packages/sdk/js/example/programmatic.ts",
  ])
  if (explicitlyPublic.has(name)) return
  if (
    name.startsWith("docs/") &&
    /\.(md|json|yml|png|gif|svg|pub|cjs|service|plist)$/.test(name) &&
    !name.split("/").some((part) => part.startsWith("."))
  )
    return
  throw new Error(`Private or unsupported export source: ${name}`)
}

export function approvedPath(base, name) {
  if (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.split("/").some((part) => ["", ".", "..", ".git", ".internal"].includes(part))
  ) {
    throw new Error(`Unsafe export path: ${name}`)
  }
  const path = resolve(base, name)
  if (relative(base, path).startsWith("..")) throw new Error(`Export escapes root: ${name}`)
  let cursor = base
  for (const part of name.split("/")) {
    cursor = join(cursor, part)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink export: ${name}`)
  }
  return path
}

export function exportSnapshot(base = root) {
  const manifest = JSON.parse(readFileSync(join(base, "script/public-docs-manifest.json"), "utf8"))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw new Error("Unsupported export manifest")
  const mapped = new Map()
  const destinations = new Set()
  for (const entry of manifest.entries) {
    assertPublicSource(entry.source)
    approvedPath(base, entry.source)
    if ((entry.page === undefined) === (entry.asset === undefined)) throw new Error(`Ambiguous export: ${entry.source}`)
    const destination =
      entry.page !== undefined ? `src/content/docs/${entry.page || "index"}.md` : `public/docs-assets/${entry.asset}`
    approvedPath(base, destination)
    if (mapped.has(entry.source) || destinations.has(destination)) throw new Error(`Duplicate export: ${entry.source}`)
    destinations.add(destination)
    mapped.set(entry.source, {
      ...entry,
      destination,
      url: entry.page !== undefined ? docUrl(entry.page) : `/docs-assets/${entry.asset}`,
    })
  }
  // These files are references only; they are never exported.
  const privateReferences = new Map([
    ["README.md", "/en/docs/"],
    ["CONTRIBUTING.md", "/en/docs/getting-started/source-access/"],
    ["CHANGELOG.md", `${downloadOrigin}/releases.json`],
  ])
  const isPrivateRepositoryUrl = (target) => /^https:\/\/github\.com\/defai-digital\/ax-code(?:[\/#]|$)/.test(target)
  const publicLink = (source, target) => {
    target = target.replace(`${websiteOrigin}/`, "/")
    if (/^(?:https?:|mailto:|#|\/)/.test(target) && !isPrivateRepositoryUrl(target)) return target
    let name = target
    if (isPrivateRepositoryUrl(target)) {
      const rest = target.slice("https://github.com/defai-digital/ax-code".length)
      if (!rest || rest.startsWith("#")) return "/en/docs/"
      if (rest.startsWith("/releases/download/")) return `${downloadOrigin}${rest}`
      if (rest.startsWith("/releases")) return `${downloadOrigin}/releases.json`
      if (rest.startsWith("/issues") || rest.startsWith("/discussions")) return "https://discord.gg/gf9UyPxaN2"
      if (rest.startsWith("/compare/")) return null
      if (rest.startsWith("/security")) return "/en/docs/security/"
      const match = rest.match(/^\/blob\/(?:main|HEAD|v\d+\.\d+\.\d+)\/(.*)$/)
      if (!match) throw new Error(`Unmapped private GitHub URL: ${target}`)
      name = match[1]
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) throw new Error(`Unsafe link scheme: ${target}`)
      name = relative(base, resolve(base, dirname(source), target.split("#")[0])).replaceAll("\\", "/")
    }
    const fragment = target.includes("#") ? `#${target.split("#")[1]}` : ""
    name = name.split("#")[0]
    if (name.startsWith("../") || name.startsWith(".internal/"))
      throw new Error(`Private or escaped link: ${source} -> ${target}`)
    if (mapped.has(name)) return mapped.get(name).url + fragment
    if (privateReferences.has(name)) return privateReferences.get(name)
    if (/^(packages|crates|script|tools)\//.test(name)) return null
    throw new Error(`Unapproved linked asset: ${source} -> ${target}`)
  }
  const files = new Map()
  const pages = []
  const records = []
  for (const entry of mapped.values()) {
    const data = readFileSync(approvedPath(base, entry.source))
    let output = entry.source.startsWith("packages/sdk/js/example/")
      ? Buffer.from(data.toString("utf8").replaceAll("@ax-code/sdk", "@defai-digital/ax-code-sdk"))
      : data
    if (entry.page !== undefined) {
      let text = data.toString("utf8")
      const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "").replace(/`[^`]*`/g, "")
      if (/<(?:script|iframe|form)\b|<[^>]+\son[a-z]+\s*=|javascript:/i.test(prose))
        throw new Error(`Unsafe documentation HTML: ${entry.source}`)
      text = text
        .split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/gm)
        .map((part) =>
          part.startsWith("```")
            ? part
            : part.replace(/`[^`]*`|(!?)\[([^\]]*)\]\(([^\s)]+)\)/g, (all, image, label, target) => {
                if (all.startsWith("`")) return all
                const url = publicLink(entry.source, target)
                if (image && url === null) throw new Error(`Unapproved documentation image: ${target}`)
                return url === null ? label : `${image}[${label}](${url})`
              }),
        )
        .join("")
      text = text.replace(
        /https:\/\/github\.com\/defai-digital\/ax-code(?![-\w])[^\s<>"')\]]*/g,
        (url) => publicLink(entry.source, url) ?? "the authorized source checkout",
      )
      if (
        /github\.com\/defai-digital\/ax-code(?:[\/#\s]|$)|raw\.githubusercontent\.com\/defai-digital\/ax-code\/|api\.github\.com\/repos\/defai-digital\/ax-code(?:[\/?#]|$)/.test(
          text,
        )
      )
        throw new Error(`Unresolved private source URL: ${entry.source}`)
      const title = text
        .match(/^# (.+)$/m)?.[1]
        ?.replace(/`([^`]+)`/g, "$1")
        .replaceAll("**", "")
      if (!title || (prose.match(/^# /gm) || []).length !== 1)
        throw new Error(`Expected one document title: ${entry.source}`)
      text = text
        .split(/(^```[^\n]*\n[\s\S]*?^```\s*$)/gm)
        .map((part) =>
          part.startsWith("```") ? part : part.replace(/[ \t]+$/gm, (spaces) => (spaces.length >= 2 ? "\\" : "")),
        )
        .join("")
      const description = `${title}: AX Code operator documentation, installation, configuration and integration guidance.`
      output = Buffer.from(
        `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nslug: ${JSON.stringify(entry.page)}\n---\n\n${text}`,
      )
      pages.push({ slug: entry.page, title, description, source: entry.source })
    }
    if (entry.asset !== undefined && /\.(json|proto|ts|yml|cjs)$/.test(entry.source)) {
      output = Buffer.from(
        output.toString("utf8").replaceAll("https://github.com/defai-digital/ax-code", "https://ax-code.app/en/docs/"),
      )
    }
    files.set(entry.destination, output)
    records.push({
      source: entry.source,
      destination: entry.destination,
      sourceSha256: hash(data),
      sha256: hash(output),
    })
  }
  const metadata = {
    schemaVersion: 1,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: base, encoding: "utf8" }).trim(),
    runtimeVersion: JSON.parse(readFileSync(join(base, "packages/ax-code/package.json"), "utf8")).version,
    sdkVersion: JSON.parse(readFileSync(join(base, "packages/sdk/js/package.json"), "utf8")).version,
    contentState: "working-tree snapshot; source hashes identify the exact exported bytes",
    pages,
    files: records,
  }
  files.set("src/content/docs-snapshot.json", Buffer.from(JSON.stringify(metadata, null, 2) + "\n"))
  return files
}

export function syncSnapshot(website, { check = false, base = root } = {}) {
  const files = exportSnapshot(base)
  const managed = ["src/content/docs", "public/docs-assets"]
  const existing = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink snapshot destination: ${path}`)
      if (lstatSync(path).isDirectory()) walk(path)
      else existing.push(relative(website, path).replaceAll("\\", "/"))
    }
  }
  for (const name of managed) {
    approvedPath(website, name)
    walk(join(website, name))
  }
  if (check) {
    const stale = [...files]
      .filter(
        ([name, data]) => !existsSync(join(website, name)) || !readFileSync(approvedPath(website, name)).equals(data),
      )
      .map(([name]) => name)
    const extra = existing.filter((name) => !files.has(name))
    if (stale.length || extra.length) throw new Error(`Stale public docs snapshot: ${[...stale, ...extra].join(", ")}`)
  } else {
    for (const name of managed) rmSync(join(website, name), { recursive: true, force: true })
    for (const [name, data] of files) {
      const target = approvedPath(website, name)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }
  }
  return files.size
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--website")
  if (index < 0 || !process.argv[index + 1])
    throw new Error("Usage: node script/export-public-docs.mjs --website PATH [--check]")
  console.log(
    `Verified ${syncSnapshot(resolve(process.argv[index + 1]), { check: process.argv.includes("--check") })} approved public documentation files.`,
  )
}
