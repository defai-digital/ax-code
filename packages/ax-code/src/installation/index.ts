import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer, Schema, ServiceMap, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { makeRunPromise } from "@/effect/run-service"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

declare global {
  const AX_CODE_VERSION: string
  const AX_CODE_CHANNEL: string
}

import semver from "semver"

export namespace Installation {
  const log = Log.create({ service: "installation" })
  export const CURRENT_NPM_PACKAGE = "@defai.digital/ax-code"
  export const LEGACY_NPM_PACKAGE = "ax-code-ai"
  export const NPM_PACKAGE_ALIASES = [CURRENT_NPM_PACKAGE, LEGACY_NPM_PACKAGE] as const
  const CURRENT_NPM_PACKAGE_PATH = encodeURIComponent(CURRENT_NPM_PACKAGE)

  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

  export type ReleaseType = "patch" | "minor" | "major"

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export function compareVersions(current: string, latest: string) {
    if (!semver.valid(current) || !semver.valid(latest)) return undefined
    return semver.compare(latest, current)
  }

  export function getReleaseType(current: string, latest: string): ReleaseType {
    const compare = compareVersions(current, latest)
    if (compare === undefined || compare <= 0) return "patch"

    const currMajor = semver.major(current)
    const currMinor = semver.minor(current)
    const newMajor = semver.major(latest)
    const newMinor = semver.minor(latest)

    if (newMajor > currMajor) return "major"
    if (newMinor > currMinor) return "minor"
    return "patch"
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  // Build-time version from AX_CODE_VERSION global, or read from package.json for dev mode
  export const VERSION = (() => {
    if (typeof AX_CODE_VERSION === "string") return AX_CODE_VERSION
    try {
      return require("../../package.json").version as string
    } catch {
      return "local"
    }
  })()
  export const CHANNEL = typeof AX_CODE_CHANNEL === "string" ? AX_CODE_CHANNEL : "local"
  export const USER_AGENT = `ax-code/${CHANNEL}/${VERSION}/${Flag.AX_CODE_CLIENT}`

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
    stderr: Schema.String,
  }) {}

  // Response schemas for external version APIs
  const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
  const NpmPackage = Schema.Struct({ version: Schema.String })
  const BrewFormula = Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })
  const BrewInfoV2 = Schema.Struct({
    formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
  })
  const ChocoPackage = Schema.Struct({
    d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
  })
  const ScoopManifest = NpmPackage

  export interface Interface {
    readonly info: () => Effect.Effect<Info>
    readonly method: () => Effect.Effect<Method>
    readonly latest: (method?: Method) => Effect.Effect<string>
    readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Installation") {}

  export const layer: Layer.Layer<Service, never, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner> =
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const text = Effect.fnUntraced(
          function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
            const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
            yield* handle.exitCode
            return out
          },
          Effect.scoped,
          Effect.catch(() => Effect.succeed("")),
        )

        const run = Effect.fnUntraced(
          function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
            const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [stdout, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, stdout, stderr }
          },
          Effect.scoped,
          Effect.catch(() => Effect.succeed({ code: ChildProcessSpawner.ExitCode(1), stdout: "", stderr: "" })),
        )

        const getBrewFormula = Effect.fnUntraced(function* () {
          // The tap historically used both "ax-code" and "ax" as formula
          // names. Probe both so we work on existing installs regardless
          // of which name the user's brew has tapped.
          const tapAxCode = yield* text(["brew", "list", "--formula", "defai-digital/ax-code/ax-code"])
          if (tapAxCode.includes("ax-code")) return "defai-digital/ax-code/ax-code"
          const tapAx = yield* text(["brew", "list", "--formula", "defai-digital/ax-code/ax"])
          if (tapAx.includes("ax")) return "defai-digital/ax-code/ax"
          const coreFormula = yield* text(["brew", "list", "--formula", "ax-code"])
          if (coreFormula.includes("ax-code")) return "ax-code"
          return "defai-digital/ax-code/ax"
        })

        const upgradeCurl = Effect.fnUntraced(
          function* (target: string) {
            const scriptUrl = "https://raw.githubusercontent.com/defai-digital/ax-code/main/install"
            const sha256Url = `${scriptUrl}.sha256`
            const response = yield* httpOk.execute(HttpClientRequest.get(scriptUrl))
            const body = yield* response.text
            // Encode once; reuse for both the SHA-256 check and the bash stdin
            // so the hash is computed over exactly the bytes that get executed.
            const bodyBytes = new TextEncoder().encode(body)
            // Verify SHA256 integrity sidecar when available. A hash mismatch
            // is a hard failure; a missing sidecar file only warns and proceeds
            // so existing deployments without a .sha256 file keep working.
            yield* Effect.promise(async () => {
              try {
                const sha256Res = await fetch(sha256Url)
                if (!sha256Res.ok) {
                  log.warn("install script .sha256 sidecar not found — skipping integrity check")
                  return
                }
                const expected = (await sha256Res.text()).trim().split(/\s+/)[0]
                if (!expected) return
                const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBytes)
                const actual = Array.from(new Uint8Array(hashBuffer))
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("")
                if (actual !== expected)
                  throw new Error(`Install script integrity check failed: expected ${expected}, got ${actual}`)
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                if (msg.startsWith("Install script integrity check failed")) throw e
                log.warn("could not verify install script integrity", { error: e })
              }
            })
            const proc = ChildProcess.make("bash", [], {
              stdin: Stream.make(bodyBytes),
              env: { VERSION: target },
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [stdout, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, stdout, stderr }
          },
          Effect.scoped,
          Effect.orDie,
        )

        const methodImpl = Effect.fn("Installation.method")(function* () {
          if (process.execPath.includes(path.join(".ax-code", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
          const exec = process.execPath.toLowerCase()

          const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
            { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
            { name: "yarn", command: () => text(["yarn", "global", "list"]) },
            { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
            { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
            {
              name: "brew",
              command: () =>
                Effect.gen(function* () {
                  for (const formula of ["defai-digital/ax-code/ax-code", "defai-digital/ax-code/ax", "ax-code"]) {
                    const out = yield* text(["brew", "list", "--formula", formula])
                    if (out.trim()) return "ax-code"
                  }
                  return ""
                }),
            },
            { name: "scoop", command: () => text(["scoop", "list", "ax-code"]) },
            { name: "choco", command: () => text(["choco", "list", "--limit-output", "ax-code"]) },
          ]

          checks.sort((a, b) => {
            const aMatches = exec.includes(a.name)
            const bMatches = exec.includes(b.name)
            if (aMatches && !bMatches) return -1
            if (!aMatches && bMatches) return 1
            return 0
          })

          for (const check of checks) {
            const output = yield* check.command()
            const installedNames =
              check.name === "brew" || check.name === "choco" || check.name === "scoop"
                ? ["ax-code"]
                : [...NPM_PACKAGE_ALIASES]
            if (installedNames.some((name) => output.includes(name))) {
              return check.name
            }
          }

          return "unknown" as Method
        })

        const latestImpl = Effect.fn("Installation.latest")(function* (installMethod?: Method) {
          const detectedMethod = installMethod || (yield* methodImpl())

          if (detectedMethod === "brew") {
            const formula = yield* getBrewFormula()
            if (formula.includes("/")) {
              const infoJson = yield* text(["brew", "info", "--json=v2", formula])
              const info = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfoV2))(infoJson)
              if (!info.formulae.length) return "unknown"
              return info.formulae[0].versions.stable
            }
            const response = yield* httpOk.execute(
              HttpClientRequest.get("https://formulae.brew.sh/api/formula/ax-code.json").pipe(
                HttpClientRequest.acceptJson,
              ),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(BrewFormula)(response)
            return data.versions.stable
          }

          if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
            const r = (yield* text(["npm", "config", "get", "registry"])).trim()
            const reg = r || "https://registry.npmjs.org"
            const registry = reg.endsWith("/") ? reg.slice(0, -1) : reg
            const channel = CHANNEL
            const response = yield* httpOk.execute(
              HttpClientRequest.get(`${registry}/${CURRENT_NPM_PACKAGE_PATH}/${channel}`).pipe(
                HttpClientRequest.acceptJson,
              ),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
            return data.version
          }

          if (detectedMethod === "choco") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27ax-code%27%20and%20IsLatestVersion&$select=Version",
              ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(response)
            if (!data.d.results?.length) return "unknown"
            return data.d.results[0].Version
          }

          if (detectedMethod === "scoop") {
            const response = yield* httpOk.execute(
              HttpClientRequest.get(
                "https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/ax-code.json",
              ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json" })),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(ScoopManifest)(response)
            return data.version
          }

          const response = yield* httpOk.execute(
            HttpClientRequest.get("https://api.github.com/repos/defai-digital/ax-code/releases/latest").pipe(
              HttpClientRequest.acceptJson,
            ),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
          return data.tag_name.replace(/^v/, "")
        }, Effect.orDie)

        const upgradeImpl = Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
          let result: { code: ChildProcessSpawner.ExitCode; stdout: string; stderr: string } | undefined
          switch (m) {
            case "curl":
              result = yield* upgradeCurl(target)
              break
            case "npm":
              result = yield* run(["npm", "install", "-g", `${CURRENT_NPM_PACKAGE}@${target}`])
              break
            case "yarn":
              result = yield* run(["yarn", "global", "add", `${CURRENT_NPM_PACKAGE}@${target}`])
              break
            case "pnpm":
              result = yield* run(["pnpm", "install", "-g", `${CURRENT_NPM_PACKAGE}@${target}`])
              break
            case "bun":
              result = yield* run(["bun", "install", "-g", `${CURRENT_NPM_PACKAGE}@${target}`])
              break
            case "brew": {
              const formula = yield* getBrewFormula()
              const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
              if (formula.includes("/")) {
                const tap = yield* run(["brew", "tap", "defai-digital/tap"], { env })
                if (tap.code !== 0) {
                  result = tap
                  break
                }
                const repo = yield* text(["brew", "--repo", "defai-digital/tap"])
                const dir = repo.trim()
                if (dir) {
                  const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
                  if (pull.code !== 0) {
                    result = pull
                    break
                  }
                }
              }
              result = yield* run(["brew", "upgrade", formula], { env })
              break
            }
            case "choco":
              result = yield* run(["choco", "upgrade", "ax-code", `--version=${target}`, "-y"])
              break
            case "scoop":
              result = yield* run(["scoop", "install", `ax-code@${target}`])
              break
            case "unknown":
              // Fallback to curl installer script when method can't be detected —
              // works regardless of install location (bun global, manual copy, etc.)
              result = yield* upgradeCurl(target)
              break
            default:
              return yield* new UpgradeFailedError({ stderr: `Unknown method: ${m}` })
          }
          if (!result || result.code !== 0) {
            const stderr = m === "choco" ? "not running from an elevated command shell" : result?.stderr || ""
            return yield* new UpgradeFailedError({ stderr })
          }
          log.info("upgraded", {
            method: m,
            target,
            stdout: result.stdout,
            stderr: result.stderr,
          })
          yield* text([process.execPath, "--version"])
        })

        return Service.of({
          info: Effect.fn("Installation.info")(function* () {
            return {
              version: VERSION,
              latest: yield* latestImpl(),
            }
          }),
          method: methodImpl,
          latest: latestImpl,
          upgrade: upgradeImpl,
        })
      }),
    )

  export const defaultLayer = layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.layer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function info(): Promise<Info> {
    return runPromise((svc) => svc.info())
  }

  export async function method(): Promise<Method> {
    return runPromise((svc) => svc.method())
  }

  export async function latest(installMethod?: Method): Promise<string> {
    return runPromise((svc) => svc.latest(installMethod))
  }

  export async function upgrade(m: Method, target: string): Promise<void> {
    return runPromise((svc) => svc.upgrade(m, target))
  }
}
