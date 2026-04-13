import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, ServiceMap } from "effect"
import { AppFileSystem } from "@/filesystem"
import { Global } from "../global"
import { Log } from "../util/log"
import { Ssrf } from "@/util/ssrf"

export namespace Discovery {
  const skillConcurrency = 4
  const fileConcurrency = 8
  const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

  class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
    name: Schema.String,
    files: Schema.Array(Schema.String),
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

      const fetchArrayBuffer = (url: string, init?: RequestInit) =>
        Effect.tryPromise({
          try: async () => {
            const res = await Ssrf.pinnedFetch(url, { ...init, label: "skill-discovery" })
            if (!res.ok) throw new Error(`skill-discovery: fetch failed for ${url}: HTTP ${res.status}`)
            return res.arrayBuffer()
          },
          catch: (err) => err,
        })

      const download = Effect.fn("Discovery.download")(function* (url: string, dest: string) {
        if (yield* fs.exists(dest).pipe(Effect.orDie)) return true

        return yield* fetchArrayBuffer(url).pipe(
          Effect.flatMap((body) => fs.writeWithDirs(dest, new Uint8Array(body))),
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
          if (!skill.files.includes("SKILL.md")) {
            log.warn("skill entry missing SKILL.md", { url: index, skill: skill.name })
            return false
          }
          return true
        })

        const dirs = yield* Effect.forEach(
          list,
          (skill) =>
            Effect.gen(function* () {
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
              const safeFiles = skill.files.filter((file) => {
                if (isExternalFileReference(file)) {
                  log.warn("skill entry has external file reference", { url: index, skill: skill.name, file })
                  return false
                }
                const resolved = path.resolve(root, file)
                if ((resolved + path.sep).startsWith(rootPrefix)) return true
                return false
              })

              yield* Effect.forEach(
                safeFiles,
                (file) => download(new URL(file, `${host}/${skill.name}/`).href, path.join(root, file)),
                {
                  concurrency: fileConcurrency,
                },
              )

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
