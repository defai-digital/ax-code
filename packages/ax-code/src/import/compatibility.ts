import path from "path"
import z from "zod"
import { parse as parseToml } from "smol-toml"
import { ConfigMarkdown } from "../config/markdown"
import { ConfigPaths } from "../config/paths"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { Global } from "../global"
import { isRecord } from "@/util/record"

export namespace CompatibilityImport {
  export const Source = z.enum(["opencode", "claude", "codex", "cursor", "windsurf"])
  export type Source = z.infer<typeof Source>

  export const Candidate = z.object({
    source: Source,
    kind: z.enum(["command", "skill", "agent", "instruction", "mcp"]),
    action: z.enum(["copy", "skip"]),
    sourcePath: z.string(),
    targetPath: z.string(),
    reason: z.string().optional(),
    warnings: z.array(z.string()).optional(),
  })
  export type Candidate = z.infer<typeof Candidate>

  export const Report = z.object({
    source: Source,
    dryRun: z.boolean(),
    total: z.number().int().nonnegative(),
    copy: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    candidates: z.array(Candidate),
  })
  export type Report = z.infer<typeof Report>

  const ROOTS: Record<Source, string> = {
    opencode: ".opencode",
    claude: ".claude",
    codex: ".codex",
    cursor: ".cursor",
    windsurf: ".windsurf",
  }

  export async function plan(input: { source: Source; directory: string; user?: boolean }): Promise<Report> {
    const parsedSource = Source.parse(input.source)
    const root = path.join(input.directory, ROOTS[parsedSource])
    const targetRoot = path.join(input.directory, ".ax-code")
    const candidates: Candidate[] = []

    candidates.push(...(await commandCandidates({ source: parsedSource, root, targetRoot })))
    candidates.push(...(await skillCandidates({ source: parsedSource, root, targetRoot })))
    candidates.push(...(await agentCandidates({ source: parsedSource, root, targetRoot })))
    if (parsedSource === "codex") {
      const agents = path.join(input.directory, "AGENTS.md")
      if (await Filesystem.exists(agents)) {
        candidates.push(
          await candidate(parsedSource, "instruction", agents, path.join(targetRoot, "instructions", "AGENTS.md")),
        )
      }
      // ADR-227: parse Codex MCP tables from .codex/config.toml. The
      // project file is always read; the home file only with --user
      // (mirrors the Claude --user rule for ~/.claude.json). The same
      // rules apply as for the Claude MCP import: disabled entries stay
      // disabled, no overwrite of existing entries, no literal env/header
      // values, name-only warnings. Parse errors become a skipped source
      // with the offending line number, never a crash.
      const codexFiles: string[] = []
      const projectCodexToml = path.join(input.directory, ".codex", "config.toml")
      if (await Filesystem.exists(projectCodexToml)) codexFiles.push(projectCodexToml)
      if (input.user) {
        const homeCodexToml = path.join(Global.Path.home, ".codex", "config.toml")
        if (await Filesystem.exists(homeCodexToml)) codexFiles.push(homeCodexToml)
      }
      if (codexFiles.length > 0) {
        candidates.push(
          ...(await codexMcpCandidates({ source: parsedSource, directory: input.directory, files: codexFiles })),
        )
      }
    }
    if (parsedSource === "cursor") {
      candidates.push(...(await cursorInstructionCandidates(parsedSource, input.directory, targetRoot)))
    }
    if (parsedSource === "windsurf") {
      candidates.push(...(await windsurfInstructionCandidates(parsedSource, input.directory, targetRoot)))
    }
    if (parsedSource === "claude") {
      candidates.push(
        ...(await mcpCandidates({ source: parsedSource, directory: input.directory, user: !!input.user })),
      )
    }

    return report(parsedSource, true, candidates)
  }

  export async function run(input: {
    source: Source
    directory: string
    write: boolean
    user?: boolean
  }): Promise<Report> {
    const planned = await plan({ source: input.source, directory: input.directory, user: input.user })
    if (!input.write) return planned

    for (const item of planned.candidates) {
      if (item.action !== "copy") continue
      // MCP servers are config entries, not file copies; applied below once
      // per config file so the JSONC merge happens a single time.
      if (item.kind === "mcp") continue
      await Filesystem.write(item.targetPath, await Filesystem.readText(item.sourcePath))
    }
    await applyMcpCandidates(input.directory, planned.candidates)

    return report(planned.source, false, planned.candidates)
  }

  async function commandCandidates(input: { source: Source; root: string; targetRoot: string }) {
    const matches = await scan(input.root, "{command,commands}/**/*.md")
    return Promise.all(
      matches.map(async (sourcePath) => {
        const rel = relativeAfterAny(sourcePath, [path.join(input.root, "command"), path.join(input.root, "commands")])
        const targetPath = path.join(input.targetRoot, "commands", rel)
        const warnings = await commandWarnings(sourcePath)
        return candidate(input.source, "command", sourcePath, targetPath, warnings)
      }),
    )
  }

  async function skillCandidates(input: { source: Source; root: string; targetRoot: string }) {
    const matches = await scan(input.root, "{skill,skills}/**/SKILL.md")
    return Promise.all(
      matches.map(async (sourcePath) => {
        const rel = relativeAfterAny(sourcePath, [path.join(input.root, "skill"), path.join(input.root, "skills")])
        const targetPath = path.join(input.targetRoot, "skill", rel)
        return candidate(input.source, "skill", sourcePath, targetPath)
      }),
    )
  }

  async function agentCandidates(input: { source: Source; root: string; targetRoot: string }) {
    const matches = await scan(input.root, "{agent,agents}/**/*.md")
    return Promise.all(
      matches.map(async (sourcePath) => {
        const rel = relativeAfterAny(sourcePath, [path.join(input.root, "agent"), path.join(input.root, "agents")])
        const targetPath = path.join(input.targetRoot, "agent", rel)
        return candidate(input.source, "agent", sourcePath, targetPath)
      }),
    )
  }

  // ADR-220: Cursor (.cursor/rules/*.mdc plus the legacy .cursorrules file)
  // and Windsurf (.windsurf/rules) rule files become instruction candidates
  // under .ax-code/instructions/, next to the codex AGENTS.md import.
  async function cursorInstructionCandidates(source: Source, directory: string, targetRoot: string) {
    const cursorRoot = path.join(directory, ".cursor")
    const matches = await scan(cursorRoot, "rules/*.mdc")
    const legacy = path.join(directory, ".cursorrules")
    const legacyExists = await Filesystem.exists(legacy)
    const candidates: Candidate[] = []
    for (const sourcePath of matches) {
      const targetPath = path.join(targetRoot, "instructions", "cursor", path.basename(sourcePath))
      candidates.push(await candidate(source, "instruction", sourcePath, targetPath))
    }
    if (legacyExists) {
      candidates.push(
        await candidate(
          source,
          "instruction",
          legacy,
          path.join(targetRoot, "instructions", "cursor", "cursorrules.md"),
        ),
      )
    }
    return candidates
  }

  async function windsurfInstructionCandidates(source: Source, directory: string, targetRoot: string) {
    const windsurfRoot = path.join(directory, ".windsurf")
    const matches = await scan(windsurfRoot, "rules/**")
    const candidates: Candidate[] = []
    for (const sourcePath of matches) {
      const rel = path.relative(path.join(windsurfRoot, "rules"), sourcePath)
      const targetPath = path.join(targetRoot, "instructions", "windsurf", rel)
      candidates.push(await candidate(source, "instruction", sourcePath, targetPath))
    }
    return candidates
  }

  // --- MCP import (ADR-220) -------------------------------------------------

  /** `${config}#mcp/<name>` display form used for MCP candidates. */
  function mcpTarget(directory: string, name: string) {
    return `${projectConfigFileFor(directory)}#mcp/${name}`
  }

  /** Prefer the live project config file, mirroring Config.projectConfigFile. */
  async function projectConfigFileFor(directory: string) {
    const jsonc = path.join(directory, "ax-code.jsonc")
    if (await Filesystem.exists(jsonc)) return jsonc
    return path.join(directory, "ax-code.json")
  }

  /** `${VAR}` / `${VAR:-default}` references, the form .mcp.json files use. */
  const ENV_REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/

  /**
   * Reduce env/header values to what may cross into a report or the target
   * config: explicit variable references become ax-code `{env:VAR}` text
   * (ConfigPaths substitutes it at load time), literals are omitted and only
   * the variable NAME is reported (ADR-220: imported values are never printed).
   */
  function redactMcpValues(kind: "env" | "header", values: unknown) {
    const warnings: string[] = []
    const kept: Record<string, string> = {}
    if (!isRecord(values)) return { kept, warnings }
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== "string") {
        warnings.push(`${kind}_value_omitted:${name}`)
        continue
      }
      const reference = value.match(ENV_REFERENCE)
      if (reference) {
        kept[name] = `{env:${reference[1]}}`
        continue
      }
      warnings.push(`${kind}_value_omitted:${name}`)
    }
    return { kept, warnings }
  }

  /** Map one Claude-style MCP server entry onto the AX Code MCP config shape. */
  function mapMcpServer(raw: unknown): { server?: Record<string, unknown>; warnings?: string[]; reason?: string } {
    if (!isRecord(raw)) return { reason: "unsupported_mcp_shape" }
    if (typeof raw.url === "string" && (raw.type === "sse" || raw.type === "http")) {
      const headers = redactMcpValues("header", raw.headers)
      return {
        server: {
          type: "remote",
          url: raw.url,
          enabled: false,
          ...(Object.keys(headers.kept).length > 0 ? { headers: headers.kept } : {}),
        },
        ...(headers.warnings.length > 0 ? { warnings: headers.warnings } : {}),
      }
    }
    if (typeof raw.command === "string" && raw.command.trim().length > 0) {
      const args = Array.isArray(raw.args) && raw.args.every((arg) => typeof arg === "string") ? raw.args : []
      const environment = redactMcpValues("env", raw.env)
      return {
        server: {
          type: "local",
          command: [raw.command, ...args],
          enabled: false,
          ...(Object.keys(environment.kept).length > 0 ? { environment: environment.kept } : {}),
        },
        ...(environment.warnings.length > 0 ? { warnings: environment.warnings } : {}),
      }
    }
    return { reason: "unsupported_mcp_shape" }
  }

  /** Claude stores MCP tables under mcpServers (top level) and projects[cwd].mcpServers. */
  function claudeMcpTable(data: unknown, directory: string): Record<string, unknown> {
    if (!isRecord(data)) return {}
    const table: Record<string, unknown> = {}
    if (isRecord(data.mcpServers)) Object.assign(table, data.mcpServers)
    const projectEntry = isRecord(data.projects) ? data.projects[path.resolve(directory)] : undefined
    const projectMcp = isRecord(projectEntry) ? projectEntry.mcpServers : undefined
    if (isRecord(projectMcp)) Object.assign(table, projectMcp)
    return table
  }

  async function mcpCandidates(input: { source: Source; directory: string; user: boolean }): Promise<Candidate[]> {
    const files = [path.join(input.directory, ".mcp.json"), path.join(input.directory, ".claude.json")]
    // User-level files are read only with the explicit --user flag (ADR-220).
    if (input.user) files.push(path.join(Global.Path.home, ".claude.json"))

    const configFile = await projectConfigFileFor(input.directory)
    const configText = await Filesystem.readText(configFile).catch(() => "")
    const configData = configText.trim() ? ConfigPaths.parseJsoncOrThrow(configText, configFile) : {}
    const existingMcp =
      isRecord(configData) && isRecord(configData.mcp) ? new Set(Object.keys(configData.mcp)) : new Set<string>()
    // Rewriting the config through JSON.stringify drops comments; warn when
    // the live file has any so the dry-run says so before --write.
    const commentsNormalized = configText.includes("//")

    const candidates: Candidate[] = []
    for (const file of files) {
      if (!(await Filesystem.exists(file))) continue
      const text = await Filesystem.readText(file).catch(() => "")
      let table: Record<string, unknown>
      try {
        table = claudeMcpTable(ConfigPaths.parseJsoncOrThrow(text, file), input.directory)
      } catch {
        candidates.push({
          source: input.source,
          kind: "mcp",
          action: "skip",
          sourcePath: file,
          targetPath: mcpTarget(input.directory, "*"),
          reason: "invalid_source_json",
        })
        continue
      }
      for (const [name, raw] of Object.entries(table)) {
        const mapped = mapMcpServer(raw)
        const warnings = [...(mapped.warnings ?? []), ...(commentsNormalized ? ["config_comments_normalized"] : [])]
        if (mapped.reason || mapped.server === undefined) {
          candidates.push({
            source: input.source,
            kind: "mcp",
            action: "skip",
            sourcePath: file,
            targetPath: mcpTarget(input.directory, name),
            reason: mapped.reason ?? "unsupported_mcp_shape",
            ...(warnings.length > 0 ? { warnings } : {}),
          })
          continue
        }
        // Existing entries are never overwritten (ADR-220).
        if (existingMcp.has(name)) {
          candidates.push({
            source: input.source,
            kind: "mcp",
            action: "skip",
            sourcePath: file,
            targetPath: mcpTarget(input.directory, name),
            reason: "target_exists",
          })
          continue
        }
        candidates.push({
          source: input.source,
          kind: "mcp",
          action: "copy",
          sourcePath: file,
          targetPath: mcpTarget(input.directory, name),
          ...(warnings.length > 0 ? { warnings } : {}),
        })
      }
    }
    return candidates
  }

  // --- Codex MCP import (ADR-227) ------------------------------------------

  /**
   * Pull a 1-based line number out of a smol-toml parse error. The error
   * message format is "TOML parse error at line N, column M" (N and M
   * integers); the regex stays loose so a future smol-toml version that
   * drops or renames the prefix still surfaces a useful line.
   */
  function extractTomlLine(error: unknown): number | undefined {
    const message = error instanceof Error ? error.message : String(error)
    const match = message.match(/(?:at\s+)?line\s+(\d+)/i)
    if (!match) return undefined
    const value = Number.parseInt(match[1], 10)
    return Number.isFinite(value) ? value : undefined
  }

  /**
   * Read a Codex config.toml and return either the parsed document or a
   * failure with the offending line number. Read failures (ENOENT, EACCES)
   * collapse to `ok: false, line: undefined` so the caller can emit a
   * single skipped source without distinguishing them.
   */
  async function readCodexToml(
    file: string,
  ): Promise<{ ok: true; data: unknown } | { ok: false; line: number | undefined }> {
    let text: string
    try {
      text = await Filesystem.readText(file)
    } catch {
      return { ok: false, line: undefined }
    }
    try {
      return { ok: true, data: parseToml(text) }
    } catch (error) {
      return { ok: false, line: extractTomlLine(error) }
    }
  }

  /** Codex stores MCP tables under a top-level `mcp_servers` table. */
  function codexMcpTable(data: unknown): Record<string, unknown> {
    if (!isRecord(data)) return {}
    const table: Record<string, unknown> = {}
    if (isRecord(data.mcp_servers)) Object.assign(table, data.mcp_servers)
    return table
  }

  /**
   * Map one Codex MCP server entry onto the AX Code MCP config shape.
   * Mirrors the Claude `mapMcpServer` for `type: "local"` (command+args)
   * and `type: "remote"` (URL), and threads the Codex-specific fields
   * `bearer_token_env_var` (translated into an `Authorization: {env:VAR}`
   * header — the variable NAME only, never the literal value) and
   * `startup_timeout` (renamed to `startup_timeout_ms` so the unit is
   * unambiguous). `disabled: true` maps to `enabled: false`; the entry
   * is still emitted (the rule: disabled entries stay disabled).
   */
  function mapCodexMcpServer(raw: unknown): { server?: Record<string, unknown>; warnings?: string[]; reason?: string } {
    if (!isRecord(raw)) return { reason: "unsupported_mcp_shape" }
    const startupTimeoutMs = (() => {
      const value = raw.startup_timeout
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
      return value
    })()
    if (typeof raw.url === "string" && raw.url.trim().length > 0) {
      const headers: Record<string, string> = {}
      const warnings: string[] = []
      if (typeof raw.bearer_token_env_var === "string" && raw.bearer_token_env_var.trim().length > 0) {
        headers["Authorization"] = `{env:${raw.bearer_token_env_var}}`
      } else if (raw.bearer_token_env_var !== undefined && raw.bearer_token_env_var !== null) {
        // Non-string bearer_token_env_var cannot be safely imported; warn
        // by name only so the value is never printed.
        warnings.push("bearer_token_env_var_omitted")
      }
      const server: Record<string, unknown> = {
        type: "remote",
        url: raw.url,
        enabled: false,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(startupTimeoutMs !== undefined ? { startup_timeout_ms: startupTimeoutMs } : {}),
      }
      return { server, ...(warnings.length > 0 ? { warnings } : {}) }
    }
    if (typeof raw.command === "string" && raw.command.trim().length > 0) {
      const args = Array.isArray(raw.args) && raw.args.every((arg) => typeof arg === "string") ? raw.args : []
      const environment = redactMcpValues("env", raw.env)
      const server: Record<string, unknown> = {
        type: "local",
        command: [raw.command, ...args],
        enabled: false,
        ...(Object.keys(environment.kept).length > 0 ? { environment: environment.kept } : {}),
        ...(startupTimeoutMs !== undefined ? { startup_timeout_ms: startupTimeoutMs } : {}),
      }
      return {
        server,
        ...(environment.warnings.length > 0 ? { warnings: environment.warnings } : {}),
      }
    }
    return { reason: "unsupported_mcp_shape" }
  }

  async function codexMcpCandidates(input: {
    source: Source
    directory: string
    files: string[]
  }): Promise<Candidate[]> {
    const configFile = await projectConfigFileFor(input.directory)
    const configText = await Filesystem.readText(configFile).catch(() => "")
    const configData = configText.trim() ? ConfigPaths.parseJsoncOrThrow(configText, configFile) : {}
    const existingMcp =
      isRecord(configData) && isRecord(configData.mcp) ? new Set(Object.keys(configData.mcp)) : new Set<string>()
    const commentsNormalized = configText.includes("//")

    const candidates: Candidate[] = []
    for (const file of input.files) {
      const parsed = await readCodexToml(file)
      if (!parsed.ok) {
        candidates.push({
          source: input.source,
          kind: "mcp",
          action: "skip",
          sourcePath: file,
          targetPath: mcpTarget(input.directory, "*"),
          reason: parsed.line !== undefined ? `invalid_source_toml:${parsed.line}` : "invalid_source_toml",
        })
        continue
      }
      const table = codexMcpTable(parsed.data)
      for (const [name, raw] of Object.entries(table)) {
        const mapped = mapCodexMcpServer(raw)
        const warnings = [...(mapped.warnings ?? []), ...(commentsNormalized ? ["config_comments_normalized"] : [])]
        if (mapped.reason || mapped.server === undefined) {
          candidates.push({
            source: input.source,
            kind: "mcp",
            action: "skip",
            sourcePath: file,
            targetPath: mcpTarget(input.directory, name),
            reason: mapped.reason ?? "unsupported_mcp_shape",
            ...(warnings.length > 0 ? { warnings } : {}),
          })
          continue
        }
        if (existingMcp.has(name)) {
          candidates.push({
            source: input.source,
            kind: "mcp",
            action: "skip",
            sourcePath: file,
            targetPath: mcpTarget(input.directory, name),
            reason: "target_exists",
          })
          continue
        }
        candidates.push({
          source: input.source,
          kind: "mcp",
          action: "copy",
          sourcePath: file,
          targetPath: mcpTarget(input.directory, name),
          ...(warnings.length > 0 ? { warnings } : {}),
        })
      }
    }
    return candidates
  }

  /** Apply copy-action MCP candidates by merging them into the project config once. */
  async function applyMcpCandidates(directory: string, candidates: Candidate[]) {
    const bySource = new Map<string, Set<string>>()
    for (const item of candidates) {
      if (item.kind !== "mcp" || item.action !== "copy") continue
      const name = item.targetPath.split("#mcp/")[1]
      if (!name) continue
      const names = bySource.get(item.sourcePath) ?? new Set<string>()
      names.add(name)
      bySource.set(item.sourcePath, names)
    }
    if (bySource.size === 0) return

    const servers: Record<string, unknown> = {}
    for (const [file, names] of bySource) {
      try {
        // ADR-227: .toml is Codex, JSON/JSONC is Claude. Dispatch to the
        // matching parser so a single apply pass can fold both sources
        // into the project config without re-reading or re-validating.
        const isToml = file.endsWith(".toml")
        let table: Record<string, unknown>
        if (isToml) {
          const parsed = await readCodexToml(file)
          if (!parsed.ok) continue
          table = codexMcpTable(parsed.data)
        } else {
          const text = await Filesystem.readText(file).catch(() => "")
          table = claudeMcpTable(ConfigPaths.parseJsoncOrThrow(text, file), directory)
        }
        for (const name of names) {
          const mapped = isToml ? mapCodexMcpServer(table[name]) : mapMcpServer(table[name])
          if (mapped.server) servers[name] = mapped.server
        }
      } catch {
        // plan already reported the file as invalid; nothing to apply.
      }
    }
    if (Object.keys(servers).length === 0) return

    const configFile = await projectConfigFileFor(directory)
    const before = await Filesystem.readText(configFile).catch(() => "")
    const text = before.trim() ? before : "{}"
    const parsed = ConfigPaths.parseJsoncOrThrow(text, configFile)
    if (!isRecord(parsed)) throw new Error(`Project config is not a JSON object: ${configFile}`)
    const mcp = { ...(isRecord(parsed.mcp) ? parsed.mcp : {}), ...servers }
    await Filesystem.write(configFile, JSON.stringify({ ...parsed, mcp }, null, 2) + "\n")
  }

  async function candidate(
    source: Source,
    kind: Candidate["kind"],
    sourcePath: string,
    targetPath: string,
    warnings?: string[],
  ): Promise<Candidate> {
    const exists = await Filesystem.exists(targetPath)
    return {
      source,
      kind,
      action: exists ? "skip" : "copy",
      sourcePath,
      targetPath,
      ...(exists ? { reason: "target_exists" } : {}),
      ...(warnings?.length ? { warnings } : {}),
    }
  }

  async function commandWarnings(sourcePath: string) {
    const md = await ConfigMarkdown.parse(sourcePath).catch(() => undefined)
    if (!md) return ["invalid_frontmatter"]
    const warnings: string[] = []
    if (ConfigMarkdown.shell(md.content).length > 0) warnings.push("unsupported_shell_interpolation")
    if (typeof (md.data as Record<string, unknown>).workflow === "string")
      warnings.push("workflow_requires_runtime_flag")
    return warnings
  }

  async function scan(root: string, pattern: string) {
    return Glob.scan(pattern, {
      cwd: root,
      absolute: true,
      include: "file",
      symlink: true,
      dot: true,
    }).catch(() => [] as string[])
  }

  function relativeAfterAny(file: string, roots: string[]) {
    for (const root of roots) {
      const rel = path.relative(root, file)
      if (Filesystem.contains(root, file)) return rel
    }
    return path.basename(file)
  }

  function report(source: Source, dryRun: boolean, candidates: Candidate[]): Report {
    return {
      source,
      dryRun,
      total: candidates.length,
      copy: candidates.filter((item) => item.action === "copy").length,
      skipped: candidates.filter((item) => item.action === "skip").length,
      candidates,
    }
  }
}
