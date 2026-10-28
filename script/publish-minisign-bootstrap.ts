import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

const HASH = /^[a-f0-9]{64}$/
const MEMBER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/

export type BootstrapExecutable = {
  path: string
  sha256: string
}

export type BootstrapArchive = {
  name: string
  sha256: string
  executables: BootstrapExecutable[]
}

export type BootstrapManifest = {
  schema: "ax-code.minisign-bootstrap.v1"
  version: string
  publicOrigin: string
  objectPrefix: string
  upstreamPrefix: string
  archives: BootstrapArchive[]
}

export type ObjectStore = {
  read(key: string): Promise<Uint8Array | null>
  write(key: string, body: Uint8Array): Promise<void>
}

type ArchiveBytes = Map<string, Uint8Array>

const manifestPath = path.join(import.meta.dirname, "minisign-bootstrap.json")

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function loadBootstrapManifest(text: string): BootstrapManifest {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid minisign bootstrap manifest")
  const record = parsed as Record<string, unknown>
  if (record.schema !== "ax-code.minisign-bootstrap.v1")
    throw new Error("Unsupported minisign bootstrap manifest schema")
  if (typeof record.version !== "string" || !/^\d+\.\d+$/.test(record.version)) {
    throw new Error("Invalid minisign bootstrap version")
  }
  if (record.publicOrigin !== "https://download.ax-code.com") throw new Error("Unexpected minisign bootstrap origin")
  if (record.objectPrefix !== `vendor/minisign/${record.version}`)
    throw new Error("Unexpected minisign bootstrap object prefix")
  if (
    typeof record.upstreamPrefix !== "string" ||
    !record.upstreamPrefix.startsWith("https://github.com/jedisct1/minisign/")
  ) {
    throw new Error("Minisign bootstrap upstream provenance is missing")
  }
  if (!Array.isArray(record.archives) || record.archives.length === 0)
    throw new Error("Minisign bootstrap manifest has no archives")
  const names = new Set<string>()
  const archives = record.archives.map((entry) => parseArchive(entry, names))
  return {
    schema: "ax-code.minisign-bootstrap.v1",
    version: record.version,
    publicOrigin: record.publicOrigin,
    objectPrefix: record.objectPrefix,
    upstreamPrefix: record.upstreamPrefix,
    archives,
  }
}

export function readBootstrapManifest(file = manifestPath): BootstrapManifest {
  return loadBootstrapManifest(fs.readFileSync(file, "utf8"))
}

export function publicObjectUrl(manifest: BootstrapManifest, name: string): string {
  return `${manifest.publicOrigin}/${manifest.objectPrefix}/${name}`
}

export function objectKey(manifest: BootstrapManifest, name: string): string {
  return `${manifest.objectPrefix}/${name}`
}

export function assertArchiveSet(files: ArchiveBytes, manifest: BootstrapManifest): void {
  const expected = new Set(manifest.archives.map((archive) => archive.name))
  const actual = [...files.keys()]
  const unknown = actual.filter((name) => !expected.has(name))
  const missing = [...expected].filter((name) => !files.has(name))
  if (unknown.length > 0 || missing.length > 0 || actual.length !== expected.size) {
    throw new Error(
      `Minisign bootstrap directory must contain exactly ${[...expected].join(", ")} (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"})`,
    )
  }
  for (const archive of manifest.archives) {
    const bytes = files.get(archive.name)
    if (!bytes) throw new Error(`Missing minisign bootstrap archive ${archive.name}`)
    const actualHash = sha256Hex(bytes)
    if (actualHash !== archive.sha256) {
      throw new Error(
        `Minisign bootstrap SHA-256 mismatch for ${archive.name} (expected ${archive.sha256}, got ${actualHash})`,
      )
    }
  }
}

export function assertMemberBytes(archive: BootstrapArchive, members: Map<string, Uint8Array>): void {
  const expected = new Set(archive.executables.map((item) => item.path))
  const actual = [...members.keys()]
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error(`Extracted ${archive.name} does not match the pinned executable set`)
  }
  for (const executable of archive.executables) {
    const bytes = members.get(executable.path)
    if (!bytes) throw new Error(`Missing extracted ${executable.path}`)
    const actualHash = sha256Hex(bytes)
    if (actualHash !== executable.sha256) {
      throw new Error(
        `Minisign executable SHA-256 mismatch for ${executable.path} (expected ${executable.sha256}, got ${actualHash})`,
      )
    }
  }
}

// A matching object is left in place. Different bytes are refused. Two publishers
// can still race between the read and the write; the following read of the
// stored and public bytes detects a lost update, but this is not an atomic create.
export async function publishVerifiedArchives(input: {
  manifest: BootstrapManifest
  files: ArchiveBytes
  objects: ObjectStore
  readPublic: (url: string) => Promise<Uint8Array>
}): Promise<{ uploaded: string[]; unchanged: string[] }> {
  assertArchiveSet(input.files, input.manifest)
  const uploaded: string[] = []
  const unchanged: string[] = []
  for (const archive of input.manifest.archives) {
    const bytes = input.files.get(archive.name)!
    const key = objectKey(input.manifest, archive.name)
    const existing = await input.objects.read(key)
    if (existing) {
      if (sha256Hex(existing) !== archive.sha256) {
        throw new Error(`Refusing to replace immutable minisign bootstrap object ${key}`)
      }
      unchanged.push(archive.name)
    } else {
      await input.objects.write(key, bytes)
      uploaded.push(archive.name)
    }
    const stored = await input.objects.read(key)
    if (!stored || sha256Hex(stored) !== archive.sha256) {
      throw new Error(`Stored minisign bootstrap object does not match the pin: ${key}`)
    }
    const published = await input.readPublic(publicObjectUrl(input.manifest, archive.name))
    if (sha256Hex(published) !== archive.sha256) {
      throw new Error(`Public minisign bootstrap object does not match the pin: ${archive.name}`)
    }
  }
  return { uploaded, unchanged }
}

export async function checkPublicArchives(
  manifest: BootstrapManifest,
  readPublic: (url: string) => Promise<Uint8Array>,
): Promise<void> {
  for (const archive of manifest.archives) {
    const bytes = await readPublic(publicObjectUrl(manifest, archive.name))
    const actual = sha256Hex(bytes)
    if (actual !== archive.sha256) {
      throw new Error(
        `Public minisign bootstrap SHA-256 mismatch for ${archive.name} (expected ${archive.sha256}, got ${actual})`,
      )
    }
  }
}

export function readArchiveDirectory(directory: string, manifest: BootstrapManifest): ArchiveBytes {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files: ArchiveBytes = new Map()
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`Unexpected non-file in minisign bootstrap directory: ${entry.name}`)
    if (files.has(entry.name)) throw new Error(`Duplicate minisign bootstrap file: ${entry.name}`)
    files.set(entry.name, fs.readFileSync(path.join(directory, entry.name)))
  }
  assertArchiveSet(files, manifest)
  for (const archive of manifest.archives) {
    const members = new Map<string, Uint8Array>()
    for (const executable of archive.executables) {
      members.set(executable.path, extractMember(path.join(directory, archive.name), executable.path))
    }
    assertMemberBytes(archive, members)
  }
  return files
}

function parseArchive(entry: unknown, names: Set<string>): BootstrapArchive {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid minisign bootstrap archive")
  const record = entry as Record<string, unknown>
  if (typeof record.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(record.name)) {
    throw new Error("Invalid minisign bootstrap archive name")
  }
  if (names.has(record.name)) throw new Error(`Duplicate minisign bootstrap archive ${record.name}`)
  names.add(record.name)
  if (typeof record.sha256 !== "string" || !HASH.test(record.sha256))
    throw new Error(`Invalid archive hash for ${record.name}`)
  if (!Array.isArray(record.executables) || record.executables.length === 0) {
    throw new Error(`Minisign bootstrap archive ${record.name} has no executables`)
  }
  const paths = new Set<string>()
  const executables = record.executables.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`Invalid executable entry in ${record.name}`)
    const executable = item as Record<string, unknown>
    if (typeof executable.path !== "string" || !MEMBER.test(executable.path) || executable.path.includes("..")) {
      throw new Error(`Invalid executable path in ${record.name}`)
    }
    if (paths.has(executable.path)) throw new Error(`Duplicate executable path in ${record.name}`)
    paths.add(executable.path)
    if (typeof executable.sha256 !== "string" || !HASH.test(executable.sha256)) {
      throw new Error(`Invalid executable hash for ${executable.path}`)
    }
    return { path: executable.path, sha256: executable.sha256 }
  })
  return { name: record.name, sha256: record.sha256, executables }
}

function extractMember(archive: string, member: string): Uint8Array {
  const zip = archive.endsWith(".zip")
  const result = zip
    ? spawnSync("unzip", ["-p", archive, member], { maxBuffer: 8 * 1024 * 1024 })
    : spawnSync("tar", ["-xOzf", archive, member], { maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error(`Failed to extract ${member} from ${path.basename(archive)}`)
  }
  return result.stdout
}

function cloudflareObjectUrl(account: string, bucket: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/")
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/r2/buckets/${encodeURIComponent(bucket)}/objects/${encodedKey}`
}

export function cloudflareObjectStore(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): ObjectStore {
  const account = env.CLOUDFLARE_ACCOUNT_ID ?? ""
  const token = env.CLOUDFLARE_API_TOKEN ?? ""
  const bucket = env.CLOUDFLARE_R2_BUCKET ?? ""
  if (!account || !token || !bucket) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_R2_BUCKET are required to publish")
  }
  const headers = { Authorization: `Bearer ${token}` }
  return {
    async read(key) {
      const response = await fetchImpl(cloudflareObjectUrl(account, bucket, key), { headers })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`R2 read failed for ${key} (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    },
    async write(key, body) {
      const response = await fetchImpl(cloudflareObjectUrl(account, bucket, key), {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: Buffer.from(body),
      })
      if (!response.ok) throw new Error(`R2 write failed for ${key} (${response.status})`)
    },
  }
}

async function readPublicBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } })
  if (!response.ok) throw new Error(`Public minisign bootstrap download failed for ${url} (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      dir: { type: "string" },
      "check-public": { type: "boolean" },
      publish: { type: "boolean" },
      "fetch-upstream": { type: "boolean" },
    },
    strict: true,
  })
  const manifest = readBootstrapManifest()
  const checkPublic = parsed.values["check-public"] === true
  const publish = parsed.values.publish === true
  const fetchUpstream = parsed.values["fetch-upstream"] === true
  const directory = parsed.values.dir
  if (!checkPublic && !publish && !fetchUpstream && !directory) {
    throw new Error("Pass --check-public, --dir <path>, --fetch-upstream --dir <path>, or --publish --dir <path>")
  }
  if ((publish || fetchUpstream) && !directory) throw new Error("--dir is required")
  if (fetchUpstream) await downloadUpstream(manifest, directory!)
  const files = directory ? readArchiveDirectory(directory, manifest) : undefined
  if (publish) {
    if (!files) throw new Error("--dir is required to publish")
    const result = await publishVerifiedArchives({
      manifest,
      files,
      objects: cloudflareObjectStore(process.env),
      readPublic: readPublicBytes,
    })
    console.log(`Uploaded ${result.uploaded.length}; unchanged ${result.unchanged.length}`)
  }
  if (checkPublic || publish) await checkPublicArchives(manifest, readPublicBytes)
  if (directory && !publish) console.log(`Verified ${manifest.archives.length} pinned minisign bootstrap archives`)
  if (checkPublic && !publish) console.log("Public minisign bootstrap archives match the pinned SHA-256 manifest")
}

async function downloadUpstream(manifest: BootstrapManifest, directory: string): Promise<void> {
  fs.mkdirSync(directory, { recursive: true })
  for (const archive of manifest.archives) {
    const destination = path.join(directory, archive.name)
    // Pinned jedisct1/minisign prefix from the local manifest. The body is the response, not a file.
    // codeql[js/file-access-to-http]
    const response = await fetch(`${manifest.upstreamPrefix}/${archive.name}`)
    if (!response.ok) throw new Error(`Upstream download failed for ${archive.name} (${response.status})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256Hex(bytes) !== archive.sha256) throw new Error(`Upstream SHA-256 mismatch for ${archive.name}`)
    // codeql[js/http-to-file-access]
    fs.writeFileSync(destination, bytes)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
