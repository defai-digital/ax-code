import z from "zod"
import { randomUUID } from "node:crypto"
import { Instance } from "../project/instance"
import type { SessionID } from "../session/schema"
import type { Tool } from "../tool/tool"
import { WebMcpProfile } from "../mcp/webmcp-profile"
import { BrowserScenario } from "./scenario"
import { BrowserRunner } from "./runner"
import { BrowserInventory } from "./inventory"
import { BrowserAuthoring } from "./authoring"
import { BrowserSelection } from "./selection"
import { readLocalSource } from "./diagnostics"

export namespace BrowserWorkbench {
  const server = z.string().min(1).max(100)
  const pageId = z.number().int().min(0)
  const origin = z
    .string()
    .max(2048)
    .refine((value) => WebMcpProfile.pageOriginOf(value) === value, "Use an exact HTTP(S) origin")
  const page = { server, pageId, origin }
  const assertions = z.array(BrowserScenario.Assertion).max(16).default([])
  const Query = z
    .object({
      name: z.string().min(1).max(128),
      descriptorHash: BrowserScenario.Hash,
      input: z.record(z.string(), z.unknown()),
      resultPath: z.array(z.string().min(1).max(100)).max(8).default([]),
      equals: z.unknown(),
    })
    .strict()
  export const Recipe = z
    .object({
      version: z.literal(1),
      name: z.string().min(1).max(200),
      origin,
      assertions,
      queries: z.array(Query).max(4).default([]),
    })
    .strict()
    .refine((value) => value.assertions.length + value.queries.length > 0, "A recipe needs explicit expected results")
  export const Actions = [
    z.object({ action: z.literal("status"), ...page }).strict(),
    z
      .object({
        action: z.literal("inventory"),
        ...page,
        baselineId: z.string().uuid().optional(),
        sourceFiles: BrowserInventory.SourceFiles,
      })
      .strict(),
    z.object({ action: z.literal("observe"), ...page, assertions, sourceFiles: BrowserInventory.SourceFiles }).strict(),
    z.object({ action: z.literal("diagnose"), observationId: z.string().uuid() }).strict(),
    z
      .object({ action: z.literal("promote"), observationId: z.string().uuid(), manifest: BrowserScenario.Manifest })
      .strict(),
    z.object({ action: z.literal("recipe"), server, pageId, definition: Recipe }).strict(),
    BrowserAuthoring.Parameters,
    BrowserSelection.Parameters,
  ] as const
  export const Parameters = z.discriminatedUnion("action", Actions)
  export type Input = z.infer<typeof Parameters>
  export type Host = {
    context: Tool.Context
    browser(server: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
    connection(server: string): Promise<{ identity: object; profile: WebMcpProfile.Configuration; tools: string[] }>
    selectionModel: string
    selectionUnavailable?: string
    select: BrowserSelection.Select
  }
  type Binding = {
    server: string
    pageId: number
    origin: string
    locationHash: string
    pathHash: string
    connection: object
  }
  type Observation = {
    snapshotHash: string
    assertions: Array<{ assertion: BrowserScenario.Assertion; status: BrowserRunner.Status }>
    console: string[]
    network: string[]
  }
  type Entry = {
    binding: Binding
    at: number
    descriptors: BrowserInventory.Descriptor[]
    sourceFiles: string[]
    observation?: Observation
  }
  const state = Instance.state(() => new Map<SessionID, Map<string, Entry>>())
  function copy(entry: Entry): Entry {
    const { connection, ...binding } = entry.binding
    return { ...structuredClone({ ...entry, binding }), binding: { ...binding, connection } }
  }
  function purge() {
    const cutoff = Date.now() - 30 * 60 * 1000
    for (const [id, entries] of state()) {
      for (const [key, entry] of entries) if (entry.at < cutoff) entries.delete(key)
      if (!entries.size) state().delete(id)
    }
  }
  function save(id: SessionID, entry: Entry) {
    purge()
    let entries = state().get(id)
    if (!entries) {
      if (state().size >= 128) throw new Error("Browser workbench session limit reached")
      entries = new Map()
      state().set(id, entries)
    }
    if (entries.size >= 16) entries.delete(entries.keys().next().value!)
    const key = randomUUID()
    entries.set(key, copy({ ...entry, at: Date.now() }))
    return key
  }
  function get(id: SessionID, key: string) {
    purge()
    const entry = state().get(id)?.get(key)
    if (!entry || Date.now() - entry.at > 30 * 60 * 1000)
      throw new Error("Unknown or expired browser baseline; capture again")
    return copy(entry)
  }
  const result = (title: string, value: unknown) => {
    BrowserInventory.bounded(value, 128 * 1024)
    return {
      title,
      output: JSON.stringify(value, null, 2),
      metadata: { untrusted: true, authority: "observation-only" },
    }
  }
  async function bind(host: Host, target: z.infer<typeof pageSchema>): Promise<Binding> {
    const current = await host.connection(target.server)
    const pages = WebMcpProfile.parseStructuredPages(
      await host.browser(target.server, "list_pages", {}, host.context.abort),
    )
    const url = pages?.get(target.pageId)
    if (!url || WebMcpProfile.pageOriginOf(url) !== target.origin)
      throw new Error("Browser target does not match the requested origin")
    return {
      server: target.server,
      pageId: target.pageId,
      origin: target.origin,
      locationHash: BrowserScenario.digest(url),
      pathHash: BrowserScenario.digest(new URL(url).pathname),
      connection: current.identity,
    }
  }
  const pageSchema = z.object(page)
  async function check(host: Host, binding: Binding) {
    const current = await bind(host, binding)
    if (current.connection !== binding.connection || current.locationHash !== binding.locationHash)
      throw new Error("Browser connection or page location changed; capture a new baseline")
  }
  async function catalog(host: Host, binding: Binding) {
    const descriptors = BrowserInventory.listing(
      await host.browser(binding.server, "list_webmcp_tools", { pageId: binding.pageId }, host.context.abort),
    )
    await check(host, binding)
    return descriptors
  }
  async function observe(host: Host, binding: Binding, checks: BrowserScenario.Assertion[]): Promise<Observation> {
    const call = (name: string, args = {}) =>
      host.browser(binding.server, name, { pageId: binding.pageId, ...args }, host.context.abort)
    await check(host, binding)
    const raw = await call("take_snapshot")
    const nodes = WebMcpProfile.parseStructuredSnapshot(raw)
    if (!nodes?.size || !BrowserRunner.losslessSnapshot(raw))
      throw new Error("Complete structured snapshot unavailable")
    const observation = {
      snapshotHash: BrowserScenario.digest([...nodes.values()].map(({ uid: _uid, ...node }) => node)),
      assertions: checks.map((assertion) => ({ assertion, status: BrowserScenario.assert(nodes.values(), assertion) })),
      console: BrowserRunner.lines(await call("list_console_messages", { types: ["error", "warn"], pageSize: 30 })),
      network: BrowserRunner.lines(await call("list_network_requests", { pageSize: 30 })),
    }
    await check(host, binding)
    BrowserInventory.bounded(observation)
    return observation
  }
  function summary(observation: Observation) {
    return observation.assertions.some((item) => item.status === "unknown")
      ? "unknown"
      : observation.assertions.some((item) => item.status === "fail")
        ? "fail"
        : observation.assertions.length
          ? "pass"
          : "observed"
  }
  const continuity =
    "Connection, page ID and URL checked; same-URL reload identity is unavailable. Observations do not qualify Arena."

  export async function execute(args: Input, host: Host) {
    BrowserInventory.bounded(args, 65536)
    host.context.abort.throwIfAborted()
    const session = host.context.sessionID
    const allow = (file: string) => host.context.ask({ permission: "read", patterns: [file], always: [], metadata: {} })
    if (args.action === "author") {
      const file = BrowserInventory.SourceFiles.parse([args.module])[0]!
      const source = await readLocalSource(Instance.worktree, file, allow)
      if (!BrowserAuthoring.hasExport(source.content, args.exportName))
        throw new Error("An explicit exported application function is required")
      return result("WebMCP application integration", {
        ...BrowserAuthoring.generate(args),
        sourceHash: source.hash,
        validated: false,
      })
    }
    if (args.action === "selection_eval") {
      if (host.selectionUnavailable) throw new Error(host.selectionUnavailable)
      const entry = get(session, args.inventoryId)
      await check(host, entry.binding)
      if (BrowserInventory.diff(entry.descriptors, await catalog(host, entry.binding)).length)
        throw new Error("Tool inventory changed; capture a new inventory before evaluating selection")
      await host.context.ask({
        permission: "browser_workflow",
        patterns: ["selection_eval"],
        always: [],
        metadata: { model: host.selectionModel, requests: args.cases.length * args.repeats, requireInteractive: true },
      })
      return result(
        "WebMCP selection evaluation",
        await BrowserSelection.evaluate(args, entry.descriptors, host.selectionModel, host.select, host.context.abort),
      )
    }
    if (args.action === "diagnose" || args.action === "promote") {
      const before = get(session, args.observationId)
      if (!before.observation) throw new Error("An observation baseline is required")
      await check(host, before.binding)
      if (args.action === "promote") {
        const url = new URL(before.binding.origin)
        if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
          throw new Error("Only localhost observations can be promoted to controlled regressions")
        if (BrowserScenario.digest(args.manifest.path) !== before.binding.pathHash)
          throw new Error("Promoted scenario must reproduce the observed page path")
        // The service freezes this explicit manifest. No observed pass/fail is copied into the receipt store.
        return { manifest: args.manifest }
      }
      const after = await observe(
        host,
        before.binding,
        before.observation.assertions.map((item) => item.assertion),
      )
      const descriptors = await catalog(host, before.binding)
      const consoleDelta = BrowserRunner.delta(before.observation.console, after.console)
      const networkDelta = BrowserRunner.delta(before.observation.network, after.network)
      const sources = await BrowserInventory.sources(Instance.worktree, before.sourceFiles, descriptors, allow)
      // Error text is evidence, never a filesystem instruction. Only explicit source-file candidates are considered.
      const sourceCandidates = before.sourceFiles.filter((file) => consoleDelta.some((line) => line.includes(file)))
      const id = save(session, { ...before, at: Date.now(), descriptors, observation: after })
      return result("Browser diagnosis", {
        observationId: id,
        origin: before.binding.origin,
        status: summary(after),
        before: before.observation,
        after,
        consoleDelta,
        networkDelta,
        inventoryChanges: BrowserInventory.diff(before.descriptors, descriptors),
        sources,
        sourceCandidates: sourceCandidates.map((file) => ({ file, confidence: "error_text_candidate" })),
        continuity,
        next: "Review the deltas and source candidates. Use promote with an explicit localhost manifest, then run a failing control before editing. No root cause is proven by correlation alone.",
      })
    }
    const target =
      args.action === "recipe" ? { server: args.server, pageId: args.pageId, origin: args.definition.origin } : args
    const binding = await bind(host, target)
    if (args.action === "status") {
      const info = await host.connection(args.server)
      const descriptors = await catalog(host, binding)
      return result("Browser capabilities", {
        origin: args.origin,
        pageId: args.pageId,
        bridge: WebMcpProfile.PACKAGE,
        tier: WebMcpProfile.promptTier(info.profile),
        tools: info.tools,
        semanticTools: descriptors.map((item) => ({
          name: item.name,
          descriptorHash: WebMcpProfile.descriptorHash(item),
        })),
        route: descriptors.length
          ? "native-tools-available"
          : info.tools.includes("take_snapshot")
            ? "snapshot-fallback-available"
            : "observation-unavailable",
        unavailable: [
          "frame attribution",
          "same-URL document identity",
          "lifecycle event stream",
          "arbitrary scripts",
          "network bodies",
          "performance traces",
        ],
        selectionEvaluation:
          host.selectionUnavailable ?? "Available with the selected model; requests require approval",
        note: "An empty listing does not establish that inaccessible frames have no tools. Tool availability does not grant approval. Use an installed connector when it better covers the task.",
        continuity,
      })
    }
    if (args.action === "inventory") {
      const before = args.baselineId ? get(session, args.baselineId) : undefined
      if (
        before &&
        (before.binding.server !== binding.server ||
          before.binding.pageId !== binding.pageId ||
          before.binding.connection !== binding.connection ||
          before.binding.locationHash !== binding.locationHash)
      )
        throw new Error("Inventory baseline belongs to a different browser target")
      const descriptors = await catalog(host, binding)
      const sources = await BrowserInventory.sources(Instance.worktree, args.sourceFiles, descriptors, allow)
      const id = save(session, { binding, at: Date.now(), descriptors, sourceFiles: args.sourceFiles })
      return result("WebMCP inventory", {
        inventoryId: id,
        origin: binding.origin,
        tools: descriptors.map((item) => ({ ...item, descriptorHash: WebMcpProfile.descriptorHash(item) })),
        changes: before ? BrowserInventory.diff(before.descriptors, descriptors) : null,
        sources,
        continuity,
      })
    }
    if (args.action === "observe") {
      const observation = await observe(host, binding, args.assertions)
      const descriptors = await catalog(host, binding)
      const id = save(session, { binding, at: Date.now(), descriptors, observation, sourceFiles: args.sourceFiles })
      return result("Browser observation", {
        observationId: id,
        origin: binding.origin,
        status: summary(observation),
        ...observation,
        continuity,
        next: "Perform the requested action once through an approved browser tool or by hand, then diagnose with this observationId.",
      })
    }
    const definition = Recipe.parse(args.definition)
    let observation = await observe(host, binding, definition.assertions)
    const queries: Array<{ name: string; status: BrowserRunner.Status }> = []
    for (const query of definition.queries) {
      const descriptors = await catalog(host, binding)
      const tool = descriptors.find((item) => item.name === query.name)
      if (!tool || WebMcpProfile.descriptorHash(tool) !== query.descriptorHash)
        throw new Error("Recipe page-tool contract changed; review the current inventory")
      const raw = await host.browser(
        binding.server,
        "execute_webmcp_tool",
        {
          pageId: binding.pageId,
          toolName: query.name,
          input: JSON.stringify(query.input),
        },
        host.context.abort,
      )
      await check(host, binding)
      const value = BrowserRunner.at(BrowserRunner.output(raw), query.resultPath)
      queries.push({
        name: query.name,
        status:
          value === undefined
            ? "unknown"
            : BrowserScenario.canonical(value) === BrowserScenario.canonical(query.equals)
              ? "pass"
              : "fail",
      })
    }
    if (definition.queries.length) observation = await observe(host, binding, definition.assertions)
    const statuses = [...observation.assertions.map((item) => item.status), ...queries.map((item) => item.status)]
    return result("Browser recipe result", {
      name: definition.name,
      origin: definition.origin,
      status: statuses.includes("unknown") ? "unknown" : statuses.includes("fail") ? "fail" : "pass",
      route: definition.queries.length ? "native-application-calls" : "snapshot-only",
      effects: definition.queries.length
        ? "application-call effects unverified; existing per-call approval required"
        : "observation-tools-only",
      assertions: observation.assertions,
      queries,
      snapshotHash: observation.snapshotHash,
      definition,
      definitionHash: BrowserScenario.digest(definition),
      continuity,
      note: "Pass means only the declared observed values matched. It is not proof of complete task coverage, no side effects, or Arena acceptance.",
    })
  }
}
