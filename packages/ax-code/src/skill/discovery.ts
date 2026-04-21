import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, ServiceMap } from "effect"
import { createHash } from "crypto"
import { AppFileSystem } from "@/filesystem"
import { Global } from "../global"
import { Log } from "../util/log"
import { Ssrf } from "@/util/ssrf"

export namespace Discovery {
  const skillConcurrency = 4
  const fileConcurrency = 8
  const MAX_SKILL_FILE_BYTES = 1024 * 1024
  const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
  const SHA256_PATTERN = /^[a-f0-9]{64}$/i

  class DiscoveryError extends Schema.TaggedErrorClass<DiscoveryError>()("SkillDiscoveryError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  const asDiscoveryError = (message: string, cause?: unknown) =>
    new DiscoveryError({
      message,
      ...(cause === undefined ? {} : { cause }),
    })

  class IndexSkillFile extends Schema.Class<IndexSkillFile>("IndexSkillFile")({
    path: Schema.String,
    sha256: Schema.optional(Schema.String),
  }) {}

  const IndexSkillFileEntry = Schema.Union([Schema.String, IndexSkillFile])

  class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
    name: Schema.String,
    files: Schema.Array(IndexSkillFileEntry),
  }) {}

  class Index extends Schema.Class<Index>("Index")({
    skills: Schema.Array(IndexSkill),
  }) {}

  export interface Interface {
    readonly pull: (url: string) => Effect.Effect<string[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/SkillDiscovery") {}

  export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Path.Path> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const log = Log.create({ service: "skill-discovery" })
      const fs = yield* AppFileSystem.Service
      const path = yield* Path.Path
      const cache = path.join(Global.Path.cache, "skills")
      const isExternalFileReference = (file: string) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(file) || file.startsWith("//")

      const normalizeFile = (file: string | IndexSkillFile) =>
        typeof file === "string" ? { path: file, sha256: undefined } : file

      const verifyFile = (body: ArrayBuffer | Uint8Array, expectedSha256: string | undefined, source: string) => {
        const buffer = Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body)
        if (buffer.byteLength > MAX_SKILL_FILE_BYTES) {
          throw asDiscoveryError(`skill-discovery: ${source} exceeds ${MAX_SKILL_FILE_BYTES} bytes`)
        }
        if (!expectedSha256) return buffer
        const expected = expectedSha256.toLowerCase()
        if (!SHA256_PATTERN.test(expected)) {
          throw asDiscoveryError(`skill-discovery: invalid sha256 for ${source}`)
        }
        const actual = createHash("sha256").update(buffer).digest("hex")
        if (actual !== expected) {
          throw asDiscoveryError(`skill-discovery: sha256 mismatch for ${source}`)
        }
        return buffer
      }

      const verifyCachedFile = (body: Uint8Array, expectedSha256: string, source: string) => {
        try {
          verifyFile(body, expectedSha256, source)
          return true
        } catch (err) {
          log.warn("cached skill file failed integrity check", { source, err })
          return false
        }
      }

      const fetchArrayBuffer = (url: string, init?: RequestInit) =>
        Effect.tryPromise({
          try: async () => {
            const res = await Ssrf.pinnedFetch(url, { ...init, label: "skill-discovery" })
            if (!res.ok) throw asDiscoveryError(`skill-discovery: fetch failed for ${url}: HTTP ${res.status}`)
            return res.arrayBuffer()
          },
          catch: (err) =>
            err instanceof DiscoveryError
              ? err
              : asDiscoveryError(`skill-discovery: fetch failed for ${url}`, err),
        })

      const download = Effect.fn("Discovery.download")(function* (url: string, dest: string, expectedSha256?: string) {
        if (yield* fs.exists(dest).pipe(Effect.orDie)) {
          if (!expectedSha256) return true

          const cached = yield* fs.readFile(dest).pipe(Effect.catch(() => Effect.void))
          if (cached && verifyCachedFile(cached, expectedSha256, dest)) {
            return true
          }
        }

        return yield* fetchArrayBuffer(url).pipe(
          Effect.flatMap((body) =>
            Effect.try({
              try: () => verifyFile(body, expectedSha256, url),
              catch: (err) =>
                err instanceof DiscoveryError
                  ? err
                  : asDiscoveryError(`skill-discovery: integrity check failed for ${url}`, err),
            }),
          ),
          Effect.flatMap((body) => fs.writeWithDirs(dest, body)),
          Effect.as(true),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to download", { url, err })
              return false
            }),
          ),
        )
      })

      const pull = Effect.fn("Discovery.pull")(function* (url: string) {
        const base = url.endsWith("/") ? url : `${url}/`
        const index = new URL("index.json", base).href
        const host = base.slice(0, -1)

        log.info("fetching index", { url: index })

        const data = yield* fetchArrayBuffer(index, { headers: { Accept: "application/json" } }).pipe(
          Effect.map((body) => JSON.parse(Buffer.from(body).toString("utf8"))),
          Effect.flatMap(Schema.decodeUnknownEffect(Index)),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to fetch index", { url: index, err })
              return null
            }),
          ),
        )

        if (!data) return []

        const list = data.skills.filter((skill) => {
          if (!SKILL_NAME_PATTERN.test(skill.name)) {
            log.warn("skill entry has unsafe name", { url: index, skill: skill.name })
            return false
          }
          const files = skill.files.map(normalizeFile)
          if (!files.some((file) => file.path === "SKILL.md")) {
            log.warn("skill entry missing SKILL.md", { url: index, skill: skill.name })
            return false
          }
          const hashless = files.find((file) => !file.sha256)
          if (hashless) {
            log.warn("skill entry missing sha256", { url: index, skill: skill.name, file: hashless.path })
            return false
          }
          const invalidHash = files.find((file) => file.sha256 && !SHA256_PATTERN.test(file.sha256))
          if (invalidHash) {
            log.warn("skill entry has invalid sha256", { url: index, skill: skill.name, file: invalidHash.path })
            return false
          }
          return true
        })

        const dirs = yield* Effect.forEach(
          list,
          (skill) =>
            Effect.gen(function* () {
              const files = skill.files.map(normalizeFile)
              const cacheRoot = path.resolve(cache)
              const root = path.resolve(cache, skill.name)
              const rootPrefix = root + path.sep
              const cachePrefix = cacheRoot + path.sep
              if (root !== cacheRoot && !rootPrefix.startsWith(cachePrefix)) {
                log.warn("skill entry escapes cache root", { url: index, skill: skill.name, root })
                return null
              }
              // Path-traversal guard: a compromised remote index
              // could list file paths like `../../etc/cron.d/evil`,
              // which `path.join(root, file)` would resolve outside
              // the cache directory. Reject any file whose resolved
              // path doesn't stay within `root` so a malicious skill
              // repo cannot write arbitrary files to disk.
              const safeFiles = files.filter((file) => {
                if (isExternalFileReference(file.path)) {
                  log.warn("skill entry has external file reference", { url: index, skill: skill.name, file })
                  return false
                }
                if (file.sha256 && !SHA256_PATTERN.test(file.sha256)) {
                  log.warn("skill entry has invalid sha256", { url: index, skill: skill.name, file })
                  return false
                }
                const resolved = path.resolve(root, file.path)
                if ((resolved + path.sep).startsWith(rootPrefix)) return true
                return false
              })

              const downloads = yield* Effect.forEach(
                safeFiles,
                (file) =>
                  download(
                    new URL(file.path, `${host}/${skill.name}/`).href,
                    path.join(root, file.path),
                    file.sha256,
                  ),
                {
                  concurrency: fileConcurrency,
                },
              )
              if (!downloads.every(Boolean)) return null

              const md = path.join(root, "SKILL.md")
              return (yield* fs.exists(md).pipe(Effect.orDie)) ? root : null
            }),
          { concurrency: skillConcurrency },
        )

        return dirs.filter((dir): dir is string => dir !== null)
      })

      return Service.of({ pull })
    }),
  )

  export const defaultLayer: Layer.Layer<Service> = layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodePath.layer),
  )
}
