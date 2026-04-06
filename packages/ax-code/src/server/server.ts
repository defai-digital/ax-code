import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import path from "path"
import { statSync } from "fs"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@ax-code/util/error"
import { LSP } from "../lsp"
import { DebugEngine } from "../debug-engine"
import { CodeIntelligence } from "../code-intelligence"
import { AutoIndex } from "../code-intelligence/auto-index"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { ProviderID } from "../provider/schema"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { EventRoutes } from "./routes/event"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { AuditRoutes } from "./routes/audit"
import { IsolationRoutes } from "./routes/isolation"
import { AutonomousRoutes } from "./routes/autonomous"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { InstructionPrompt } from "@/session/instruction"
import * as MemoryStore from "@/memory/store"
import { getMetadata as getMemoryMetadata } from "@/memory/injector"
import { generate as generateMemory } from "@/memory/generator"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

const AppContextFile = z.object({
  name: z.string(),
  path: z.string(),
  exists: z.boolean(),
  scope: z.enum(["project", "global"]),
})

const AppContextMemory = z.object({
  exists: z.boolean(),
  totalTokens: z.number(),
  lastUpdated: z.string(),
  contentHash: z.string(),
  sections: z.array(z.string()),
})

const AppContextTemplate = z.object({
  key: z.enum(["repo-rules", "dir-rules", "review-checklist", "frontend-style-guide", "release-checklist"]),
  title: z.string(),
  description: z.string(),
  path: z.string(),
  exists: z.boolean(),
  kind: z.enum(["instruction", "checklist"]),
})

const AppContextCheck = z.object({
  id: z.string(),
  title: z.string(),
  command: z.string(),
  cwd: z.string(),
  source: z.enum(["root", "directory"]),
})

const AppContextInfo = z.object({
  directory: z.string(),
  worktree: z.string(),
  files: z.array(AppContextFile),
  instructions: z.array(AppContextFile),
  templates: z.array(AppContextTemplate),
  checks: z.array(AppContextCheck),
  memory: AppContextMemory.nullable(),
})

const AppContextTemplateRequest = z.object({
  key: AppContextTemplate.shape.key,
})

type AppContextTemplateData = Omit<z.infer<typeof AppContextTemplate>, "exists">
type AppContextCheckData = z.infer<typeof AppContextCheck>

function contextTemplates(input: { root: string; dir: string }) {
  const list: AppContextTemplateData[] = [
    {
      key: "repo-rules" as const,
      title: "Repo rules",
      description: "Default instructions for this repository.",
      path: path.join(input.root, "AGENTS.md"),
      kind: "instruction" as const,
    },
    {
      key: "review-checklist" as const,
      title: "Review checklist",
      description: "A reusable checklist for code review and verification.",
      path: path.join(input.root, "docs", "review-checklist.md"),
      kind: "checklist" as const,
    },
    {
      key: "frontend-style-guide" as const,
      title: "Frontend style guide",
      description: "UI and UX guidance for interface changes.",
      path: path.join(input.root, "docs", "frontend-style-guide.md"),
      kind: "checklist" as const,
    },
    {
      key: "release-checklist" as const,
      title: "Release checklist",
      description: "Pre-release verification steps and rollout notes.",
      path: path.join(input.root, "docs", "release-checklist.md"),
      kind: "checklist" as const,
    },
  ]

  if (path.resolve(input.dir) !== path.resolve(input.root)) {
    list.splice(1, 0, {
      key: "dir-rules" as const,
      title: "Directory rules",
      description: "Instructions scoped to the current working directory.",
      path: path.join(input.dir, "AGENTS.md"),
      kind: "instruction" as const,
    })
  }

  return list
}

function templateBody(input: { key: z.infer<typeof AppContextTemplateRequest>["key"]; root: string; dir: string }) {
  switch (input.key) {
    case "repo-rules":
      return [
        "# Project Instructions",
        "",
        "## Workflow",
        "- Inspect the existing code before changing it.",
        "- Keep changes scoped to the request.",
        "- Run the relevant checks before finishing.",
        "",
        "## Review",
        "- Prioritize bugs, regressions, and missing tests.",
        "- Call out risky assumptions and follow-up work.",
        "",
        "## Style",
        "- Match the existing patterns in this repository.",
        "- Prefer clear labels, safe defaults, and concise explanations.",
      ].join("\n")
    case "dir-rules":
      return [
        "# Directory Instructions",
        "",
        `Scope: \`${path.relative(input.root, input.dir) || "."}\``,
        "",
        "## Focus",
        "- Keep changes in this directory aligned with the local patterns.",
        "- Reuse nearby components, helpers, and naming conventions first.",
        "",
        "## Checks",
        "- Run the narrowest relevant checks for this area before finishing.",
        "- Note any file-specific risks or follow-up items in the summary.",
      ].join("\n")
    case "review-checklist":
      return [
        "# Review Checklist",
        "",
        "- [ ] Confirm the changed files match the request.",
        "- [ ] Check loading, empty, and error states.",
        "- [ ] Verify renamed or deleted imports, routes, and references.",
        "- [ ] Run the relevant tests, lint, and build checks.",
        "- [ ] Note follow-up risks, assumptions, or rollout concerns.",
      ].join("\n")
    case "frontend-style-guide":
      return [
        "# Frontend Style Guide",
        "",
        "- Reuse shared components, tokens, and layout patterns before adding new ones.",
        "- Keep primary actions obvious and labels specific.",
        "- Cover empty, loading, and error states for new UI.",
        "- Verify responsive layout, keyboard flow, and text truncation.",
        "- Prefer low-risk presentation changes over new runtime behavior unless necessary.",
      ].join("\n")
    case "release-checklist":
      return [
        "# Release Checklist",
        "",
        "- [ ] Review user-facing changes and migration notes.",
        "- [ ] Run tests, lint, and build checks for the affected packages.",
        "- [ ] Confirm config, dependency, or env changes are documented.",
        "- [ ] Verify monitoring, rollback, or support notes if risk is non-trivial.",
        "- [ ] Capture any follow-up work that should not block release.",
      ].join("\n")
  }
}

function quote(value: string) {
  return /\s/.test(value) ? JSON.stringify(value) : value
}

async function packageManager(cwd: string, root: string) {
  for await (const file of Filesystem.up({
    targets: ["pnpm-lock.yaml", "bun.lockb", "bun.lock", "yarn.lock", "package-lock.json"],
    start: cwd,
    stop: root,
  })) {
    const name = path.basename(file)
    if (name === "pnpm-lock.yaml") return "pnpm" as const
    if (name === "bun.lockb" || name === "bun.lock") return "bun" as const
    if (name === "yarn.lock") return "yarn" as const
    if (name === "package-lock.json") return "npm" as const
  }
  return "npm" as const
}

function checkLabel(name: string) {
  switch (name) {
    case "check":
      return "Check"
    case "typecheck":
      return "Typecheck"
    case "test":
      return "Test"
    case "lint":
      return "Lint"
    case "build":
      return "Build"
    case "verify":
      return "Verify"
    case "format":
      return "Format"
    default:
      return name
  }
}

function checkCommand(input: { manager: "pnpm" | "bun" | "yarn" | "npm"; root: string; cwd: string; name: string }) {
  const rel = path.relative(input.root, input.cwd)
  if (input.manager === "pnpm") {
    if (!rel) return `pnpm ${input.name}`
    return `pnpm --dir ${quote(rel)} ${input.name}`
  }
  if (input.manager === "bun") {
    if (!rel) return `bun run ${input.name}`
    return `bun --cwd ${quote(rel)} run ${input.name}`
  }
  if (input.manager === "yarn") {
    if (!rel) return `yarn ${input.name}`
    return `yarn --cwd ${quote(rel)} ${input.name}`
  }
  if (!rel) return `npm run ${input.name}`
  return `npm --prefix ${quote(rel)} run ${input.name}`
}

function checkTitle(input: { root: string; cwd: string; name: string }) {
  const rel = path.relative(input.root, input.cwd)
  if (!rel) return checkLabel(input.name)
  return `${rel} ${checkLabel(input.name).toLowerCase()}`
}

function inDir(root: string, cwd: string, command: string) {
  const rel = path.relative(root, cwd)
  if (!rel) return command
  return `cd ${quote(rel)} && ${command}`
}

function addCheck(
  out: AppContextCheckData[],
  seen: Set<string>,
  input: { root: string; cwd: string; name: string; command: string },
) {
  const command = input.command.trim()
  if (!command || seen.has(command)) return false
  seen.add(command)

  const rel = path.relative(input.root, input.cwd)
  out.push({
    id: `${rel || "."}:${input.name}:${out.length}`,
    title: checkTitle(input),
    command,
    cwd: input.cwd,
    source: path.resolve(input.cwd) === path.resolve(input.root) ? ("root" as const) : ("directory" as const),
  })
  return out.length >= 4
}

function makeTargets(text: string) {
  const out = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue
    if (line.startsWith("#")) continue
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:/)
    if (!match) continue
    out.add(match[1])
  }
  return out
}

async function contextChecks(input: { root: string; dir: string }) {
  const order = ["typecheck", "test", "lint", "build"] as const
  const rootPkg = path.join(input.root, "package.json")
  const nearest = (await Filesystem.findUp("package.json", input.dir, input.root))[0]
  const pkgs = Array.from(new Set([rootPkg, nearest].filter((item): item is string => !!item)))
  const seen = new Set<string>()
  const out: AppContextCheckData[] = []

  for (const file of pkgs) {
    const json = await Filesystem.readJson<{ scripts?: Record<string, string> }>(file).catch(() => null)
    const scripts = json?.scripts
    if (!scripts) continue

    const cwd = path.dirname(file)
    const manager = await packageManager(cwd, input.root)

    for (const name of order) {
      if (!scripts[name]) continue
      const command = checkCommand({ manager, root: input.root, cwd, name })
      if (addCheck(out, seen, { root: input.root, cwd, name, command })) return out
    }
  }

  const makeOrder = ["verify", "check", "test", "lint", "build", "typecheck"] as const
  const makeFiles = Array.from(
    new Set([path.join(input.root, "Makefile"), ...(await Filesystem.findUp("Makefile", input.dir, input.root))]),
  )
  for (const file of makeFiles) {
    if (!(await Filesystem.exists(file))) continue
    const text = await Filesystem.readText(file).catch(() => "")
    const targets = makeTargets(text)
    const cwd = path.dirname(file)
    for (const name of makeOrder) {
      if (!targets.has(name)) continue
      if (addCheck(out, seen, { root: input.root, cwd, name, command: inDir(input.root, cwd, `make ${name}`) }))
        return out
    }
  }

  const denoFiles = Array.from(
    new Set([
      path.join(input.root, "deno.json"),
      path.join(input.root, "deno.jsonc"),
      ...(await Filesystem.findUp("deno.json", input.dir, input.root)),
      ...(await Filesystem.findUp("deno.jsonc", input.dir, input.root)),
    ]),
  )
  for (const file of denoFiles) {
    if (!(await Filesystem.exists(file))) continue
    const cwd = path.dirname(file)
    if (addCheck(out, seen, { root: input.root, cwd, name: "check", command: inDir(input.root, cwd, "deno check .") }))
      return out
    if (addCheck(out, seen, { root: input.root, cwd, name: "test", command: inDir(input.root, cwd, "deno test") }))
      return out
    if (
      addCheck(out, seen, {
        root: input.root,
        cwd,
        name: "format",
        command: inDir(input.root, cwd, "deno fmt --check"),
      })
    )
      return out
  }

  const cargoFiles = Array.from(
    new Set([path.join(input.root, "Cargo.toml"), ...(await Filesystem.findUp("Cargo.toml", input.dir, input.root))]),
  )
  for (const file of cargoFiles) {
    if (!(await Filesystem.exists(file))) continue
    const cwd = path.dirname(file)
    if (addCheck(out, seen, { root: input.root, cwd, name: "test", command: inDir(input.root, cwd, "cargo test") }))
      return out
    if (addCheck(out, seen, { root: input.root, cwd, name: "check", command: inDir(input.root, cwd, "cargo check") }))
      return out
    if (addCheck(out, seen, { root: input.root, cwd, name: "build", command: inDir(input.root, cwd, "cargo build") }))
      return out
  }

  const goFiles = Array.from(
    new Set([path.join(input.root, "go.mod"), ...(await Filesystem.findUp("go.mod", input.dir, input.root))]),
  )
  for (const file of goFiles) {
    if (!(await Filesystem.exists(file))) continue
    const cwd = path.dirname(file)
    if (addCheck(out, seen, { root: input.root, cwd, name: "test", command: inDir(input.root, cwd, "go test ./...") }))
      return out
    if (
      addCheck(out, seen, { root: input.root, cwd, name: "build", command: inDir(input.root, cwd, "go build ./...") })
    )
      return out
  }

  return out
}

export namespace Server {
  const log = Log.create({ service: "server" })

  export const Default = lazy(() => createApp({}))

  export const createApp = (opts: { cors?: string[] }): Hono => {
    const app = new Hono()
    return app
      .onError((err, c) => {
        log.error("failed", {
          error: err,
        })
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
          else if (err.name === "ProviderAuthValidationFailed") status = 400
          else if (err.name.startsWith("Worktree")) status = 400
          else status = 500
          return c.json(err.toObject(), { status })
        }
        if (err instanceof HTTPException) return err.getResponse()
        // Return a generic message to the client; the full stack was
        // already logged by `log.error("failed", { error: err })` above.
        // Previously this returned `err.stack` in the response body,
        // which leaked internal paths, function names, line numbers,
        // and library versions to any caller that could reach the
        // server. Clients get a short message and a 500 — operators
        // see the full trace in the logs.
        const message = err instanceof Error ? err.message : "Internal server error"
        return c.json(new NamedError.Unknown({ message }).toObject(), {
          status: 500,
        })
      })
      .use((c, next) => {
        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return next()
        const password = Flag.AX_CODE_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
        return basicAuth({ username, password })(c, next)
      })
      .use(async (c, next) => {
        const skipLogging = c.req.path === "/log"
        if (!skipLogging) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        if (!skipLogging) {
          timer.stop()
        }
      })
      .use(
        cors({
          origin(input) {
            if (!input) return

            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (opts?.cors?.includes(input)) {
              return input
            }

            return
          },
        }),
      )
      .route("/global", GlobalRoutes())
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        validator("json", Auth.Info.zod),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          const info = c.req.valid("json")
          await Auth.set(providerID, info)
          // Invalidate the per-directory provider cache so the next
          // `Provider.list()` re-reads auth and shows the new key
          // without requiring a process restart. See issue #13.
          await Provider.invalidate()
          return c.json(true)
        },
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          // Same rationale as the PUT handler — a removed key must
          // also disappear from the provider list without a restart.
          // See issue #13.
          await Provider.invalidate()
          return c.json(true)
        },
      )
      .use(async (c, next) => {
        if (c.req.path === "/log") return next()
        const raw =
          c.req.query("directory") ||
          c.req.header("x-ax-code-directory") ||
          c.req.header("x-opencode-directory") ||
          process.cwd()
        const decoded = (() => {
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        })()
        // Validate the directory before it becomes Instance.directory
        // — the containment root that every file tool measures
        // symlink escapes against. Without this, a request with
        // `?directory=/` or `?directory=/etc` would silently grant
        // the full filesystem (or a sensitive subtree) as the
        // project root, bypassing the per-tool sandbox. Reject
        // non-absolute paths, non-existent paths, and non-directory
        // paths with a 400. Defaulted `process.cwd()` values are
        // always trusted (no user input involved).
        const directory = path.resolve(decoded)
        if (decoded !== process.cwd()) {
          if (!path.isAbsolute(decoded)) {
            return c.json({ error: "directory must be absolute" }, 400)
          }
          const stat = (() => {
            try {
              return statSync(directory)
            } catch {
              return undefined
            }
          })()
          if (!stat?.isDirectory()) {
            return c.json({ error: "directory does not exist or is not a directory" }, 400)
          }
        }
        return Instance.provide({
          directory,
          init: InstanceBootstrap,
          async fn() {
            return next()
          },
        })
      })
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "AX Code",
              version: "0.0.3",
              description: "AX Code API",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
          }),
        ),
      )
      .route("/project", ProjectRoutes())
      .route("/pty", PtyRoutes())
      .route("/config", ConfigRoutes())
      .route("/isolation", IsolationRoutes())
      .route("/autonomous", AutonomousRoutes())
      .route("/experimental", ExperimentalRoutes())
      .route("/session", SessionRoutes())
      .route("/permission", PermissionRoutes())
      .route("/audit", AuditRoutes())
      .route("/question", QuestionRoutes())
      .route("/provider", ProviderRoutes())
      .route("/", FileRoutes())
      .route("/", EventRoutes())
      .route("/mcp", McpRoutes())
      .route("/tui", TuiRoutes())
      .post(
        "/instance/dispose",
        describeRoute({
          summary: "Dispose instance",
          description: "Clean up and dispose the current ax-code instance, releasing all resources.",
          operationId: "instance.dispose",
          responses: {
            200: {
              description: "Instance disposed",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Instance.dispose()
          return c.json(true)
        },
      )
      .post(
        "/instance/restart",
        describeRoute({
          summary: "Restart instance",
          description: "Dispose and reinitialize the ax-code instance, reloading all configuration and provider data.",
          operationId: "instance.restart",
          responses: {
            200: {
              description: "Instance restarted",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Instance.dispose()
          return c.json(true)
        },
      )
      .get(
        "/path",
        describeRoute({
          summary: "Get paths",
          description: "Retrieve the current working directory and related path information for the ax-code instance.",
          operationId: "path.get",
          responses: {
            200: {
              description: "Path",
              content: {
                "application/json": {
                  schema: resolver(
                    z
                      .object({
                        home: z.string(),
                        state: z.string(),
                        config: z.string(),
                        worktree: z.string(),
                        directory: z.string(),
                      })
                      .meta({
                        ref: "Path",
                      }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json({
            home: Global.Path.home,
            state: Global.Path.state,
            config: Global.Path.config,
            worktree: Instance.worktree,
            directory: Instance.directory,
          })
        },
      )
      .get(
        "/vcs",
        describeRoute({
          summary: "Get VCS info",
          description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
          operationId: "vcs.get",
          responses: {
            200: {
              description: "VCS info",
              content: {
                "application/json": {
                  schema: resolver(Vcs.Info),
                },
              },
            },
          },
        }),
        async (c) => {
          const branch = await Vcs.branch()
          return c.json({
            branch,
          })
        },
      )
      .get(
        "/command",
        describeRoute({
          summary: "List commands",
          description: "Get a list of all available commands in the ax-code system.",
          operationId: "command.list",
          responses: {
            200: {
              description: "List of commands",
              content: {
                "application/json": {
                  schema: resolver(Command.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const commands = await Command.list()
          return c.json(commands)
        },
      )
      .post(
        "/log",
        describeRoute({
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
          operationId: "app.log",
          responses: {
            200: {
              description: "Log entry written successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            service: z.string().max(64).regex(/^[a-zA-Z0-9._-]+$/).meta({ description: "Service name for the log entry" }),
            level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
            message: z.string().meta({ description: "Log message" }),
            extra: z
              .record(z.string(), z.any())
              .optional()
              .meta({ description: "Additional metadata for the log entry" }),
          }),
        ),
        async (c) => {
          const { service, level, message, extra } = c.req.valid("json")
          const logger = Log.create({ service })

          switch (level) {
            case "debug":
              logger.debug(message, extra)
              break
            case "info":
              logger.info(message, extra)
              break
            case "error":
              logger.error(message, extra)
              break
            case "warn":
              logger.warn(message, extra)
              break
          }

          return c.json(true)
        },
      )
      .get(
        "/context",
        describeRoute({
          summary: "Get project context",
          description: "Get instruction-file and cached-memory metadata for the current project context.",
          operationId: "app.context",
          responses: {
            200: {
              description: "Current project context information",
              content: {
                "application/json": {
                  schema: resolver(AppContextInfo),
                },
              },
            },
          },
        }),
        async (c) => {
          const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
          const scope = (p: string) => {
            if (Filesystem.contains(root, p)) return "project"
            if (Filesystem.contains(Instance.directory, p)) return "project"
            return "global"
          }
          const names = ["AGENTS.md", "CLAUDE.md", "AX.md"]
          const files = await Promise.all(
            names.map(async (name) => {
              const found = (await Filesystem.findUp(name, Instance.directory, root))[0]
              const file = found ?? path.join(root, name)
              return {
                name,
                path: file,
                exists: !!found,
                scope: scope(file),
              }
            }),
          )
          const instructions = Array.from(await InstructionPrompt.systemPaths())
            .sort((a, b) => a.localeCompare(b))
            .map((file) => ({
              name: path.basename(file),
              path: file,
              exists: true,
              scope: scope(file),
            }))
          const templates = await Promise.all(
            contextTemplates({ root, dir: Instance.directory }).map(async (item) => ({
              ...item,
              exists: await Filesystem.exists(item.path),
            })),
          )
          const memory = await getMemoryMetadata(root)
          const checks = await contextChecks({ root, dir: Instance.directory })
          return c.json({
            directory: Instance.directory,
            worktree: root,
            files,
            instructions,
            templates,
            checks,
            memory,
          })
        },
      )
      .post(
        "/context/template",
        describeRoute({
          summary: "Create project context template",
          description: "Create a recommended rules or checklist file for the current project context.",
          operationId: "app.contextTemplateCreate",
          responses: {
            200: {
              description: "Template file metadata",
              content: {
                "application/json": {
                  schema: resolver(AppContextTemplate),
                },
              },
            },
          },
        }),
        validator("json", AppContextTemplateRequest),
        async (c) => {
          const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
          const dir = Instance.directory
          const key = c.req.valid("json").key
          const item = contextTemplates({ root, dir }).find((template) => template.key === key)
          if (!item) {
            throw new NamedError.Unknown({
              message: `Unknown project context template: ${key}`,
            })
          }

          if (!(await Filesystem.exists(item.path))) {
            await Filesystem.write(item.path, templateBody({ key, root, dir }))
          }

          return c.json({
            ...item,
            exists: true,
          })
        },
      )
      .post(
        "/context/memory/warmup",
        describeRoute({
          summary: "Refresh project memory",
          description: "Generate and cache fresh project memory for the current context.",
          operationId: "app.contextMemoryWarmup",
          responses: {
            200: {
              description: "Refreshed project memory metadata",
              content: {
                "application/json": {
                  schema: resolver(AppContextMemory),
                },
              },
            },
          },
        }),
        async (c) => {
          const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
          const memory = await generateMemory(root, {
            maxTokens: 4000,
            depth: 3,
          })
          await MemoryStore.save(root, memory)
          return c.json({
            exists: true,
            totalTokens: memory.totalTokens,
            lastUpdated: memory.updated,
            contentHash: memory.contentHash,
            sections: Object.keys(memory.sections).filter((key) => {
              const section = memory.sections[key as keyof typeof memory.sections]
              return !!section && section.tokens > 0
            }),
          })
        },
      )
      .delete(
        "/context/memory",
        describeRoute({
          summary: "Clear project memory",
          description: "Delete cached project memory for the current context.",
          operationId: "app.contextMemoryClear",
          responses: {
            200: {
              description: "Whether cached memory was cleared",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
          return c.json(await MemoryStore.clear(root))
        },
      )
      .get(
        "/agent",
        describeRoute({
          summary: "List agents",
          description: "Get a list of all available AI agents in the ax-code system.",
          operationId: "app.agents",
          responses: {
            200: {
              description: "List of agents",
              content: {
                "application/json": {
                  schema: resolver(Agent.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const modes = await Agent.list()
          return c.json(modes)
        },
      )
      .get(
        "/skill",
        describeRoute({
          summary: "List skills",
          description: "Get a list of all available skills in the ax-code system.",
          operationId: "app.skills",
          responses: {
            200: {
              description: "List of skills",
              content: {
                "application/json": {
                  schema: resolver(Skill.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const skills = await Skill.all()
          return c.json(skills)
        },
      )
      .get(
        "/lsp",
        describeRoute({
          summary: "Get LSP status",
          description: "Get LSP server status",
          operationId: "lsp.status",
          responses: {
            200: {
              description: "LSP server status",
              content: {
                "application/json": {
                  schema: resolver(LSP.Status.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await LSP.status())
        },
      )
      .get(
        "/debug-engine/pending-plans",
        describeRoute({
          summary: "DRE status and pending refactor plans",
          description:
            "Return the current project's pending refactor plans plus DRE health information (graph node count, last-indexed timestamp, registered tool count). The TUI footer uses the plans count for its chip; the TUI sidebar uses the graph and tool fields to render the DRE section empty state so users can tell at a glance whether DRE is ready to use. Fields default to zero / null when the experimental DRE flag is off, so callers can poll unconditionally. The `graph` and `toolCount` fields were added in v2.3.6 — older clients ignore unknown fields and continue to work against the original `{ count, plans }` shape.",
          operationId: "debugEngine.pendingPlans",
          responses: {
            200: {
              description: "DRE status + pending refactor plans",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      count: z.number(),
                      plans: z.array(
                        z.object({
                          planId: z.string(),
                          kind: z.string(),
                          risk: z.string(),
                          summary: z.string(),
                          affectedFileCount: z.number(),
                          affectedSymbolCount: z.number(),
                          timeCreated: z.number(),
                        }),
                      ),
                      // v2.3.6 additions — surface DRE readiness in the TUI sidebar.
                      toolCount: z.number(),
                      graph: z.object({
                        nodeCount: z.number(),
                        edgeCount: z.number(),
                        lastIndexedAt: z.number().nullable(),
                        // v2.3.13 additions — surface in-progress and failed
                        // auto-index runs so the sidebar can distinguish
                        // "not indexed, about to start" from "indexing"
                        // from "indexing failed, here's why".
                        state: z.union([z.literal("idle"), z.literal("indexing"), z.literal("failed")]),
                        completed: z.number(),
                        total: z.number(),
                        error: z.string().nullable(),
                      }),
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          // Silent no-op when the flag is off so the TUI can poll
          // unconditionally without branching on flag state. The v2.3.6
          // fields (`toolCount`, `graph`) default to zero / null so the
          // sidebar renders a coherent "DRE disabled" empty state
          // without any flag branching on the client.
          if (!Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
            return c.json({
              count: 0,
              plans: [],
              toolCount: 0,
              graph: {
                nodeCount: 0,
                edgeCount: 0,
                lastIndexedAt: null,
                state: "idle" as const,
                completed: 0,
                total: 0,
                error: null,
              },
            })
          }
          const projectID = Instance.project.id
          const plans = DebugEngine.listPlans(projectID, { status: "pending", limit: 25 })
          // DRE ships exactly six tools today. Hard-coding matches the
          // registry wiring at tool/registry.ts — if a tool is added
          // or removed, update this count alongside the registry
          // change so the sidebar stays accurate.
          const DRE_TOOL_COUNT = 6
          const graph = CodeIntelligence.status(projectID)
          const indexState = AutoIndex.getState(projectID)
          return c.json({
            count: plans.length,
            plans: plans.map((p) => ({
              planId: p.planId as unknown as string,
              kind: p.kind,
              risk: p.risk,
              // Trim the markdown summary for list display — the full
              // summary is still available via getPlan if a caller wants it.
              summary: p.summary.split("\n").slice(0, 2).join("\n"),
              affectedFileCount: p.affectedFiles.length,
              affectedSymbolCount: p.affectedSymbols.length,
              timeCreated: p.explain.indexedAt,
            })),
            toolCount: DRE_TOOL_COUNT,
            graph: {
              nodeCount: graph.nodeCount,
              edgeCount: graph.edgeCount,
              lastIndexedAt: graph.lastUpdated,
              state: indexState.state,
              completed: indexState.completed,
              total: indexState.total,
              error: indexState.error,
            },
          })
        },
      )
      .get(
        "/formatter",
        describeRoute({
          summary: "Get formatter status",
          description: "Get formatter status",
          operationId: "formatter.status",
          responses: {
            200: {
              description: "Formatter status",
              content: {
                "application/json": {
                  schema: resolver(Format.Status.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await Format.status())
        },
      )
  }

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(Default(), {
      documentation: {
        info: {
          title: "ax-code",
          version: "1.0.0",
          description: "ax-code api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  /** @deprecated do not use this dumb shit */
  export let url: URL

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
    url = new URL(`http://${opts.hostname}:${server.port}`)

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
