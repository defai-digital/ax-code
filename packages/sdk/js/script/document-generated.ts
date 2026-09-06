import fs from "node:fs/promises"
import path from "node:path"

/**
 * Injects JSDoc comments into the hey-api generated sources under `src/gen`
 * and `src/v2/gen`. The generator does not document its output, which used to
 * leave the published JSR package with ~1% symbol documentation. This pass
 * runs after code generation and patching, before Prettier and tsc, and is
 * deterministic so regeneration always yields the same docs.
 *
 * Doc sources, in priority order per symbol:
 *  1. an existing JSDoc block (never overwritten)
 *  2. OpenAPI schema `description` (types.gen symbols matching a schema name)
 *  3. the operation behind generated `*Data`/`*Response(s)`/`*Error(s)` types
 *  4. the `type:` discriminator literal for generated server event payloads
 *  5. a curated documentation table for the stable client/serializer helpers
 *  6. a generic generated-symbol fallback
 *
 * Generated service methods (both the per-tag classes and the flat
 * `AxCodeClient` facade) are matched to operations by their HTTP verb + URL
 * template in the method body, which is immune to operationId naming rules.
 */

type OperationInfo = {
  verb: string
  path: string
  summary: string
  description: string
}

type Contract = {
  byVerbPath: Map<string, OperationInfo>
  byPascalBase: Map<string, OperationInfo>
  schemaDescriptions: Map<string, string>
}

const TYPE_SUFFIXES = ["Data", "Responses", "Response", "Errors", "Error"] as const

function splitIdentifier(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0)
}

function pascal(value: string): string {
  return splitIdentifier(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

function operationLabel(operation: OperationInfo): string {
  return `\`${operation.verb.toUpperCase()} ${operation.path}\``
}

async function loadJsonObject(file: string): Promise<Record<string, unknown>> {
  const text = await fs.readFile(file, "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Failed to parse ${file} as JSON`, { cause: error })
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

async function loadContract(openApiPath: string): Promise<Contract> {
  const spec = await loadJsonObject(openApiPath)
  const paths = spec.paths as
    | Record<string, Record<string, { summary?: string; description?: string } | undefined>>
    | undefined
  const schemas = (spec.components as { schemas?: Record<string, { description?: string }> } | undefined)?.schemas

  const byVerbPath = new Map<string, OperationInfo>()
  const byPascalBase = new Map<string, OperationInfo>()
  for (const [routePath, methods] of Object.entries(paths ?? {})) {
    for (const [verb, rawOperation] of Object.entries(methods)) {
      if (!rawOperation || typeof rawOperation !== "object") continue
      const operation = rawOperation as { operationId?: string; summary?: string; description?: string }
      const info: OperationInfo = {
        verb,
        path: routePath,
        summary: (operation.summary ?? operation.description ?? "").trim(),
        description: (operation.description ?? "").trim(),
      }
      byVerbPath.set(`${verb.toLowerCase()} ${routePath}`, info)
      // Generated `*Data`/`*Response(s)`/`*Error(s)` type names derive from the
      // operationId, which this repo emits as dotted identifiers (`session.list`)
      // and hey-api renders in PascalCase.
      if (operation.operationId) byPascalBase.set(pascal(operation.operationId), info)
    }
  }

  const schemaDescriptions = new Map<string, string>()
  for (const [name, schema] of Object.entries(schemas ?? {})) {
    const description = schema?.description?.trim()
    if (description) schemaDescriptions.set(name, description)
  }

  return { byVerbPath, byPascalBase, schemaDescriptions }
}

/** True when the declaration at `index` already has a doc block above it. */
function hasLeadingDoc(lines: string[], index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const trimmed = lines[j].trim()
    if (trimmed === "") continue
    return trimmed.endsWith("*/")
  }
  return false
}

function blockComment(lines: string[], indent = ""): string[] {
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`]
  return [`${indent}/**`, ...lines.map((line) => `${indent} * ${line}`), `${indent} */`]
}

const STABLE_DOCS: Record<string, string> = {
  // ── Generated client primitives (gen/client) ──────────────────────────
  Client: "Low-level HTTP transport used by the generated AX Code API services.",
  ClientOptions: "Options accepted by `createClient` (base URL, fetch implementation, middleware, ...).",
  Config: "Runtime configuration of a generated client instance: baseUrl, headers, fetch, and parsers.",
  CreateClientConfig: "Callback that can customize the client `Config` while the client is being created.",
  Options:
    "Per-call options bag for generated API methods: path/query/header parameters, request body, abort signal, and response parsing.",
  RequestOptions: "Request execution options such as `throwOnError`, `responseStyle`, and `parseAs`.",
  RequestResult:
    "Result object used by `responseStyle: 'results'` calls, carrying `data`, `error`, and the raw `response`.",
  ResolvedRequestOptions: "Per-call `Options` after client-level defaults have been merged in.",
  ResponseStyle: "Whether generated methods throw on API errors (`'throw'`) or return a `RequestResult` (`'results'`).",
  TDataShape: "Describes the body/path/query/url shape of one generated API request.",
  createClient: "Create a raw HTTP client for the AX Code server from a `Config`.",
  createConfig: "Normalize and validate user input into a full client `Config`.",
  mergeHeaders: "Merge header sets into a single record; later entries win.",
  client: "Shared default client instance used by generated services when a call omits `options.client`.",

  // ── Auth ───────────────────────────────────────────────────────────────
  Auth: "Auth token state consumed by the generated client's auth layer.",
  getAuthToken: "Return the current auth token, preferring an explicitly supplied one.",
  createAuth: "Create the token store used by the generated client's auth interceptor.",

  // ── Serialization helpers (gen/core) ──────────────────────────────────
  BodySerializer: "Function that serializes a request body for a given content type.",
  SerializerOptions: "Configuration for array/object parameter serialization styles.",
  QuerySerializer: "Function that serializes the whole query object into a query string.",
  QuerySerializerOptions: "Style and explode options controlling how query values are serialized.",
  buildUrl: "Expand path parameters and append the serialized query string to a URL template.",
  buildClientParams: "Flatten the generated `{ body, path, query, header }` request shape into client options.",
  serializeQueryKeyValue: "Serialize a single query value according to its style/explode options.",
  serializeArrayParam: "Serialize an array parameter using the given style and separator.",
  serializeObjectParam: "Serialize an object parameter using the given style and separator.",
  serializePrimitiveParam: "Serialize a primitive parameter (string, number, boolean).",
  formDataBodySerializer: "Body serializer for `multipart/form-data` requests.",
  jsonBodySerializer: "Body serializer for `application/json` requests (the default).",
  urlSearchParamsBodySerializer: "Body serializer for `application/x-www-form-urlencoded` requests.",
  defaultPathSerializer: "Default path-parameter serializer: percent-encodes plain string values.",
  getParseAs: "Resolve the response parser for a content type (`json`, `text`, `blob`, ...).",
  getUrl: "Compose the final request URL from the configured baseUrl and the request path.",
  getValidRequestBody: "Return the request body to send, honoring the configured body serializer.",
  mergeConfigs: "Deep-merge two client configs; the second config wins for scalar fields.",
  createInterceptors: "Create the request/response/error interceptor registry for a client.",
  createQuerySerializer: "Build a query-string serializer from `QuerySerializerOptions` or a custom function.",
  createSseClient: "Create a server-sent-events consumer used by streaming endpoints.",
  PATH_PARAM_RE: "Regular expression matching `{param}` placeholders in URL templates.",
  queryKeyJsonReplacer: "JSON replacer that produces stable query keys for nested objects.",
  stringifyToJsonValue: "Stringify a value into a JSON-compatible primitive.",
  separatorArrayExplode: "Separator used for exploded array serialization (`?tag=a&tag=b`).",
  separatorArrayNoExplode: "Separator used for non-exploded array serialization (`?tag=a,b`).",
  separatorObjectExplode: "Separator used for exploded object serialization (`?key=value`).",
  separatorObjectNoExplode: "Separator used for non-exploded object serialization.",

  // ── SSE / misc types ──────────────────────────────────────────────────
  ServerSentEventsOptions:
    "Options for consuming a server-sent-events stream (retry behavior, idle timeout, handlers).",
  ServerSentEventsResult: "Handler callbacks invoked while consuming a server-sent-events stream.",
  HttpMethod: "HTTP methods supported by the generated transport.",
  Middleware: "Interceptor hook that can observe or rewrite requests and responses.",
  OmitNever: "Type-level helper that drops keys whose type resolves to `never`.",
  JsonSchema: "JSON Schema definition passed through by the API contract.",
  ApiError: "Error shape returned for non-2xx AX Code API responses.",

  // ── sdk.gen.ts facade ─────────────────────────────────────────────────
  AxCodeClient:
    "Flat typed facade over every AX Code HTTP API operation, generated from the OpenAPI contract. " +
    "Method names come from the operationId suffix, so similarly named operations on different resources " +
    "share a method slot here; prefer the per-tag service classes (for example `Session`, `App`, `Provider`) " +
    "for unambiguous namespacing, or use `createAxCodeClient` from `@defai-digital/ax-code-sdk/v2`.",
}

function genericDoc(name: string): string {
  return `AX Code API schema \`${name}\` (auto-generated from the OpenAPI contract).`
}

function typeSuffixDoc(name: string, contract: Contract): string[] | undefined {
  for (const suffix of TYPE_SUFFIXES) {
    if (!name.endsWith(suffix)) continue
    const operation = contract.byPascalBase.get(name.slice(0, -suffix.length))
    if (!operation) continue
    const lead = [
      "Request payload shape for",
      "Success response payloads for",
      "Successful response payload for",
      "Error response payloads for",
      "Error response payload for",
    ][TYPE_SUFFIXES.indexOf(suffix)]
    return [`${lead} ${operationLabel(operation)}${operation.summary ? ` — ${operation.summary}` : ""}`]
  }
  return undefined
}

function eventLiteralDoc(lines: string[], startIndex: number, name: string): string[] | undefined {
  if (!name.startsWith("Event")) return undefined
  for (let j = startIndex; j < Math.min(startIndex + 40, lines.length); j++) {
    const match = lines[j].match(/^\s+type: "([^"]+)"/)
    if (match) return [`Server event payload with \`type: "${match[1]}"\` (auto-generated).`]
    if (j > startIndex && /^export /.test(lines[j])) break
  }
  return undefined
}

function documentDeclarations(source: string, contract: Contract): string {
  const lines = source.split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(
      /^export (?:abstract class|class|interface|type|const|let|var|enum|function|declare function|declare const) ([A-Za-z0-9_]+)/,
    )
    if (!match || hasLeadingDoc(lines, i)) {
      out.push(line)
      continue
    }
    const name = match[1]
    let doc: string[] | undefined
    const schemaDescription = contract.schemaDescriptions.get(name)
    if (schemaDescription) {
      doc = [schemaDescription]
    }
    doc ??= typeSuffixDoc(name, contract)
    doc ??= eventLiteralDoc(lines, i, name)
    doc ??= STABLE_DOCS[name] ? [STABLE_DOCS[name]] : undefined
    doc ??= [genericDoc(name)]
    out.push(...blockComment(doc, ""))
    out.push(line)
  }
  return out.join("\n")
}

const HTTP_VERB_RE = /\.(get|post|put|patch|delete|head|options|trace)[<(]/
const URL_TEMPLATE_RE = /url: "([^"]+)"/
const PUBLIC_METHOD_RE = /^\s*public [A-Za-z0-9_]+\s*[<(]/

/** Attach operation docs to generated service methods, matched by verb + URL. */
function documentSdkMethods(source: string, contract: Contract): string {
  const lines = source.split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (PUBLIC_METHOD_RE.test(line) && !hasLeadingDoc(lines, i)) {
      const indent = line.match(/^(\s*)/)?.[1] ?? ""
      let verb: string | undefined
      let url: string | undefined
      for (let j = i + 1; j < Math.min(i + 80, lines.length); j++) {
        verb ??= lines[j].match(HTTP_VERB_RE)?.[1]
        url ??= lines[j].match(URL_TEMPLATE_RE)?.[1]
        if (verb && url) break
        if (PUBLIC_METHOD_RE.test(lines[j]) || /^}/.test(lines[j])) break
      }
      const operation = verb && url ? contract.byVerbPath.get(`${verb} ${url}`) : undefined
      if (operation) {
        const summary = operation.summary || operation.description
        const docLines = [`${summary ? `${summary}.` : "Generated API method."}`.replace(/^./, (c) => c.toUpperCase())]
        docLines.push("", `Calls ${operationLabel(operation)}.`)
        out.push(...blockComment(docLines, indent))
      }
    }
    out.push(line)
  }
  return out.join("\n")
}

/** Attach class docs to generated service classes (tag groups + facade). */
function documentSdkClasses(source: string): string {
  const lines = source.split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^export class ([A-Za-z0-9_]+)/)
    if (match && !hasLeadingDoc(lines, i)) {
      const name = match[1]
      const curated = STABLE_DOCS[name]
      const doc = curated
        ? [curated]
        : [`${name.replace(/[0-9_]+$/, "")} API operations (auto-generated from the AX Code OpenAPI contract).`]
      out.push(...blockComment(doc, ""))
    }
    out.push(line)
  }
  return out.join("\n")
}

const MODULE_DOC = [
  "/**",
  " * Generated HTTP client primitives for the AX Code server API: the transport",
  " * factory, configuration types, and request/response serializers produced by",
  " * `@hey-api/openapi-ts`. This module is regenerated on every SDK build; do not",
  " * edit it by hand.",
  " *",
  " * @module",
  " */",
].join("\n")

function ensureModuleDoc(source: string): string {
  if (source.includes("@module")) return source
  return `${MODULE_DOC}\n${source}`
}

async function walkTsFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await walkTsFiles(full)))
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full)
  }
  return out.sort()
}

export async function documentGeneratedSources(packageDir: string): Promise<void> {
  const contract = await loadContract(path.join(packageDir, "openapi.json"))
  const treeRoots = [path.join(packageDir, "src", "gen"), path.join(packageDir, "src", "v2", "gen")]
  for (const treeRoot of treeRoots) {
    for (const file of await walkTsFiles(treeRoot)) {
      const original = await fs.readFile(file, "utf8")
      let source = original
      const relative = path.relative(treeRoot, file)
      if (relative === path.join("client", "index.ts")) {
        source = ensureModuleDoc(source)
      }
      source = documentDeclarations(source, contract)
      if (relative === "sdk.gen.ts") {
        source = documentSdkMethods(source, contract)
        source = documentSdkClasses(source)
      }
      if (source !== original) await fs.writeFile(file, source)
    }
  }
}
