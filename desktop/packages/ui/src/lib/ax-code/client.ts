import { createAxCodeClient, type AxCodeClient } from "@ax-code/sdk/v2/client"
import type { FilesAPI, RuntimeAPIs } from "../api/types"
import { API_ENDPOINTS, HTTP_DEFAULTS, API_PATHS, replacePathParams } from "@/lib/http"
import { getDesktopHomeDirectory } from "../desktop"
import type {
  Session,
  Message,
  Part,
  Provider,
  Config,
  Model,
  Agent,
  TextPartInput,
  FilePartInput,
} from "@ax-code/sdk/v2"
import type { PermissionRequest } from "@/types/permission"
import type { QuestionRequest } from "@/types/question"
import { waitForWorktreeBootstrap } from "@/lib/worktrees/worktreeBootstrap"
import { buildAxCodeApiUrl, normalizeAxCodeSdkBaseUrl } from "./baseUrl"
import {
  assertProviderCircuitClosed,
  recordProviderSuccess,
  recordProviderError,
  shouldRetry,
  getRetryDelayMs,
} from "./provider-tracker"

// Use relative path by default (works with both dev and nginx proxy server)
// Can be overridden with VITE_AX_CODE_URL for absolute URLs in special deployments
const getConfiguredBaseUrl = (): string | undefined => {
  const env = (import.meta as ImportMeta & { env?: { VITE_AX_CODE_URL?: unknown } }).env
  return typeof env?.VITE_AX_CODE_URL === "string" && env.VITE_AX_CODE_URL.length > 0 ? env.VITE_AX_CODE_URL : undefined
}

const DEFAULT_BASE_URL = getConfiguredBaseUrl() || API_PATHS.base

// Safety cap on how long the serialized directory-context queue will wait on a
// single call before letting the next one run. Without this, one hung
// directory-scoped request (never resolving nor rejecting) poisons the shared
// queue and stalls every subsequent call — e.g. the sandbox/autonomous toggles
// spinning forever. The hung caller still awaits its own real result; only the
// queue's readiness for the NEXT call is bounded.
const DIRECTORY_CONTEXT_QUEUE_TIMEOUT_MS = 15_000

/**
 * Render an SDK error payload into a short string for Error messages.
 * The SDK returns `{data, error}` shape without throwing on non-2xx; methods
 * that need to signal failure (so callers can preserve state instead of
 * conflating failure with an empty success) wrap the error with this helper.
 */
function formatSdkError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Render a non-OK prompt_async response body into a user-facing message.
 *
 * The backend returns structured error bodies for bad requests. A stale or
 * invalid provider/model pair is NOT surfaced as `name: "ProviderModelNotFoundError"`;
 * the upstream error normalizer collapses `Provider.ModelNotFoundError` into the
 * generic envelope `{ "name": "InvalidRequestError", "message": "Provider model
 * not found", "status": 400, "details": { "resource": "providerModel" } }`
 * (see ax-code `server/error.ts`). Matching on the name alone therefore never
 * fired, so detection keys off `details.resource === 'providerModel'` (with the
 * message text as a fallback). All other errors keep the generic suffix form.
 */
export function formatPromptSendError(status: number, body: string): string {
  const trimmed = body && body.trim().length > 0 ? body.trim() : ""

  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const errObj =
        parsed && typeof parsed === "object" ? ((parsed as { error?: unknown }).error ?? parsed) : undefined
      if (errObj && typeof errObj === "object") {
        const err = errObj as { name?: unknown; message?: unknown; details?: { resource?: unknown } }
        const resource = err.details && typeof err.details === "object" ? err.details.resource : undefined
        const isStaleModel =
          err.name === "ProviderModelNotFoundError" ||
          resource === "providerModel" ||
          err.message === "Provider model not found"
        if (isStaleModel) {
          return "The selected model is no longer available. Please choose another model."
        }
      }
    } catch {
      // Body is not JSON — fall through to generic suffix form.
    }
    return `Failed to send message (${status}): ${trimmed}`
  }

  return `Failed to send message (${status})`
}
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//
const ID_RANDOM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const ID_RANDOM_LENGTH = 14

// The backend brands message and part identifiers and rejects the entire
// prompt with an opaque `InvalidRequestError` (400, "Invalid request") when a
// `messageID` does not start with "msg" or any part `id` does not start with
// "prt" (see ax-code `id/branded.ts` + `session/message-v2.ts` PartBase). UI
// code only ever holds client-local ids (e.g. `inline-server-…`, timestamp-
// based), which are not valid brands, so they must never be forwarded as part
// ids on the wire — doing so fails the whole send, not just that part.
const MESSAGE_ID_PREFIX = "msg"
const PART_ID_PREFIX = "prt"
const isValidPartId = (id: unknown): id is string => typeof id === "string" && id.startsWith(`${PART_ID_PREFIX}_`)
const isValidMessageId = (id: unknown): id is string => typeof id === "string" && id.startsWith(MESSAGE_ID_PREFIX)

let lastIdTimestamp = 0
let idCounter = 0

const randomBase62 = (length: number): string => {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  let result = ""
  for (let index = 0; index < length; index += 1) {
    result += ID_RANDOM_CHARS[bytes[index] % ID_RANDOM_CHARS.length]
  }
  return result
}

export const ascendingId = (prefix: "msg" | "prt"): string => {
  const timestamp = Date.now()
  if (timestamp !== lastIdTimestamp) {
    lastIdTimestamp = timestamp
    idCounter = 0
  }
  idCounter += 1

  // Must match the server encoding (packages/ax-code/src/id/id.ts Identifier.create):
  // timestamp * 0x1000 + counter. A different multiplier packs the timestamp into different
  // bytes, so client (user) and server (assistant) ids sort inconsistently and the id-sorted
  // sync store reorders the transcript (issue #325).
  const sortable = BigInt(timestamp) * BigInt(0x1000) + BigInt(idCounter)
  const timeBytes = new Uint8Array(6)
  for (let index = 0; index < 6; index += 1) {
    timeBytes[index] = Number((sortable >> BigInt(40 - 8 * index)) & BigInt(0xff))
  }
  const hex = Array.from(timeBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${prefix}_${hex}${randomBase62(ID_RANDOM_LENGTH)}`
}

const isRetryableFetchError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === "AbortError") return true
  if (error instanceof TypeError) return true
  return false
}

const ensureAbsoluteBaseUrl = (candidate: string): string => {
  const normalized = typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : API_PATHS.base

  if (ABSOLUTE_URL_PATTERN.test(normalized)) {
    return normalized
  }

  if (typeof window === "undefined") {
    return normalized
  }

  const baseReference = window.location?.href || window.location?.origin
  if (!baseReference) {
    return normalized
  }

  try {
    return new URL(normalized, baseReference).toString()
  } catch (error) {
    console.warn("Failed to normalize ax-code base URL:", error)
    return normalized
  }
}

const resolveDesktopBaseUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null
  }
  const desktopServer = (
    window as typeof window & {
      __AX_CODE_DESKTOP_DESKTOP_SERVER__?: { origin: string; apiPrefix?: string }
      __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs
    }
  ).__AX_CODE_DESKTOP_DESKTOP_SERVER__

  const isDesktop = Boolean(
    (window as typeof window & { __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs }).__AX_CODE_DESKTOP_RUNTIME_APIS__
      ?.runtime?.isDesktop,
  )

  if (!desktopServer || !isDesktop) {
    return null
  }

  const origin =
    typeof desktopServer.origin === "string" && desktopServer.origin.length > 0 ? desktopServer.origin : null
  if (!origin) {
    return null
  }

  return `${origin.replace(/\/+$/, "")}${API_PATHS.base}`
}

interface App {
  version?: string
  [key: string]: unknown
}

export type FilesystemEntry = {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink?: boolean
}

export type ProjectFileSearchHit = {
  name: string
  path: string
  relativePath: string
  extension?: string
}

type AgentPartInputLite = {
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

type FileInputLite = {
  id?: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: FilePartInput["source"]
}

export type DirectorySwitchResult = {
  success: boolean
  restarted: boolean
  path: string
  agents?: Agent[]
  providers?: Provider[]
  models?: unknown[]
}

const normalizeFsPath = (path: string): string => path.replace(/\\/g, "/")
const FS_LIST_CACHE_TTL_MS = 400

const getDesktopFilesApi = (): FilesAPI | null => {
  if (typeof window === "undefined") {
    return null
  }
  const apis = (window as typeof window & { __AX_CODE_DESKTOP_RUNTIME_APIS__?: RuntimeAPIs })
    .__AX_CODE_DESKTOP_RUNTIME_APIS__
  if (apis && apis.runtime?.isDesktop && apis.files) {
    return apis.files
  }
  return null
}

class AxCodeService {
  private client: AxCodeClient
  private baseUrl: string
  private scopedClients: Map<string, AxCodeClient> = new Map()
  private currentDirectory: string | undefined = undefined
  private directoryContextQueue: Promise<void> = Promise.resolve()
  private listDirectoryInFlight: Map<string, Promise<FilesystemEntry[]>> = new Map()
  private listDirectoryCache: Map<string, { entries: FilesystemEntry[]; expiresAt: number }> = new Map()
  private listDirectoryCacheGeneration = 0

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    const desktopBase = resolveDesktopBaseUrl()
    const requestedBaseUrl = desktopBase || baseUrl
    this.baseUrl = normalizeAxCodeSdkBaseUrl(ensureAbsoluteBaseUrl(requestedBaseUrl))
    this.client = createAxCodeClient({ baseUrl: this.baseUrl })
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  /** Expose the raw SDK client for direct use (e.g., SyncProvider) */
  getSdkClient(): AxCodeClient {
    return this.client
  }

  /** Get a scoped SDK client for a specific directory */
  getScopedSdkClient(directory: string): AxCodeClient {
    return this.getScopedApiClient(directory)
  }

  /**
   * Returns an SDK client scoped to a project directory.
   * Needed for worktree APIs where backend ignores per-call directory.
   */
  getScopedApiClient(directory: string): AxCodeClient {
    const normalized = this.normalizeCandidatePath(directory) ?? directory
    const key = normalized || ""
    const existing = this.scopedClients.get(key)
    if (existing) {
      return existing
    }
    const scoped = createAxCodeClient({ baseUrl: this.baseUrl, directory: normalized })
    this.scopedClients.set(key, scoped)
    return scoped
  }

  private normalizeCandidatePath(path?: string | null): string | null {
    if (typeof path !== "string") {
      return null
    }

    const trimmed = path.trim()
    if (!trimmed) {
      return null
    }

    // Normalize backslashes and uppercase the Windows drive letter so that
    // d:\MyProject and D:\MyProject resolve to the same canonical form.
    const normalized = trimmed
      .replace(/\\/g, "/")
      .replace(/^([a-z]):/, (_, letter: string) => letter.toUpperCase() + ":")
    const driveRoot = normalized.match(/^([A-Z]:)\/+$/)
    if (driveRoot) {
      return `${driveRoot[1]}/`
    }
    if (/^[A-Z]:$/.test(normalized)) {
      return `${normalized}/`
    }
    const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized

    return withoutTrailingSlash || null
  }

  private invalidateListDirectoryCacheForPath(path?: string | null): void {
    const normalized = this.normalizeCandidatePath(path)
    if (!normalized) {
      this.listDirectoryCacheGeneration += 1
      this.listDirectoryCache.clear()
      this.listDirectoryInFlight.clear()
      return
    }

    const directories = new Set<string>([normalized])
    const parentRaw = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ""
    const parent = this.normalizeCandidatePath(parentRaw)
    if (parent) {
      directories.add(parent)
    }

    for (const directory of directories) {
      const prefix = `${directory}|`
      for (const key of this.listDirectoryCache.keys()) {
        if (key.startsWith(prefix)) {
          this.listDirectoryCache.delete(key)
        }
      }
      for (const key of this.listDirectoryInFlight.keys()) {
        if (key.startsWith(prefix)) {
          this.listDirectoryInFlight.delete(key)
        }
      }
    }

    this.listDirectoryCacheGeneration += 1
  }

  private deriveHomeDirectory(path: string): { homeDirectory: string; username?: string } {
    const windowsMatch = path.match(/^([A-Za-z]:)(?:\/|$)/)
    if (windowsMatch) {
      const drive = windowsMatch[1]
      const remainder = path.slice(drive.length + (path.charAt(drive.length) === "/" ? 1 : 0))
      const segments = remainder.split("/").filter(Boolean)

      if (segments.length >= 2) {
        const homeDirectory = `${drive}/${segments[0]}/${segments[1]}`
        return { homeDirectory, username: segments[1] }
      }

      if (segments.length === 1) {
        const homeDirectory = `${drive}/${segments[0]}`
        return { homeDirectory, username: segments[0] }
      }

      return { homeDirectory: `${drive}/`, username: undefined }
    }

    const absolute = path.startsWith("/")
    const segments = path.split("/").filter(Boolean)

    if (segments.length >= 2 && (segments[0] === "Users" || segments[0] === "home")) {
      const homeDirectory = `${absolute ? "/" : ""}${segments[0]}/${segments[1]}`
      return { homeDirectory, username: segments[1] }
    }

    if (absolute) {
      if (segments.length === 0) {
        return { homeDirectory: "/", username: undefined }
      }
      const homeDirectory = `/${segments.join("/")}`
      return { homeDirectory, username: segments[segments.length - 1] }
    }

    if (segments.length > 0) {
      const homeDirectory = `/${segments.join("/")}`
      return { homeDirectory, username: segments[segments.length - 1] }
    }

    return { homeDirectory: "/", username: undefined }
  }

  // Set the current working directory for all API calls
  setDirectory(directory: string | undefined) {
    this.currentDirectory = this.normalizeCandidatePath(directory) ?? directory
  }

  getDirectory(): string | undefined {
    return this.currentDirectory
  }

  async withDirectory<T>(directory: string | undefined | null, fn: () => Promise<T>): Promise<T> {
    const runWithContext = async (): Promise<T> => {
      if (directory === undefined || directory === null) {
        return fn()
      }

      const previousDirectory = this.currentDirectory
      this.currentDirectory = this.normalizeCandidatePath(directory) ?? directory
      try {
        return await fn()
      } finally {
        this.currentDirectory = previousDirectory
      }
    }

    const queuedRun = this.directoryContextQueue.then(runWithContext, runWithContext)
    // Advance the shared queue when this run settles OR after a safety timeout,
    // so a single hung call can't block every subsequent directory-scoped
    // request forever. The caller still awaits `queuedRun` (its real result);
    // only the queue's readiness for the next call is time-bounded.
    this.directoryContextQueue = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DIRECTORY_CONTEXT_QUEUE_TIMEOUT_MS)
      const advance = () => {
        clearTimeout(timer)
        resolve()
      }
      queuedRun.then(advance, advance)
    })

    return queuedRun
  }

  // Get the raw API client for direct access
  getApiClient(): AxCodeClient {
    return this.client
  }

  // Get system information including home directory
  async getSystemInfo(): Promise<{ homeDirectory: string; username?: string }> {
    const candidates = new Set<string>()
    const addCandidate = (value?: string | null) => {
      const normalized = this.normalizeCandidatePath(value)
      if (normalized) {
        candidates.add(normalized)
      }
    }

    try {
      const response = await this.client.path.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      const info = response.data
      if (info) {
        addCandidate(info.directory)
        addCandidate(info.worktree)
        addCandidate(info.state)
      }
    } catch (error) {
      console.debug("Failed to load path info:", error)
    }

    if (!candidates.size) {
      try {
        const project = await this.client.project.current(
          this.currentDirectory ? { directory: this.currentDirectory } : undefined,
        )
        addCandidate(project.data?.worktree)
      } catch (error) {
        console.debug("Failed to load project info:", error)
      }
    }

    if (!candidates.size) {
      try {
        const sessions = await this.listSessions()
        sessions.forEach((session) => addCandidate(session.directory))
      } catch (error) {
        console.debug("Failed to inspect sessions for system info:", error)
      }
    }

    addCandidate(this.currentDirectory)

    if (typeof window !== "undefined") {
      try {
        addCandidate(window.localStorage.getItem("lastDirectory"))
        addCandidate(window.localStorage.getItem("homeDirectory"))
      } catch {
        // Access to storage failed (e.g. privacy mode)
      }
    }

    if (!candidates.size && typeof process !== "undefined" && typeof process.cwd === "function") {
      addCandidate(process.cwd())
    }

    if (!candidates.size) {
      return { homeDirectory: "/", username: undefined }
    }

    const [primary] = Array.from(candidates)
    return this.deriveHomeDirectory(primary)
  }

  /**
   * Best-effort probe whether a directory is accessible to ax-code.
   * This is intentionally NOT the same as local filesystem access in the UI runtime.
   */
  async probeDirectory(directory: string): Promise<boolean> {
    const normalized = this.normalizeCandidatePath(directory)
    if (!normalized) {
      return false
    }
    try {
      const response = await this.client.path.get({ directory: normalized })
      const info = response.data as { directory?: unknown } | undefined
      const returned = typeof info?.directory === "string" ? info.directory : null
      return Boolean(returned && returned.trim().length > 0)
    } catch {
      return false
    }
  }

  // Session Management
  async listSessions(): Promise<Session[]> {
    const response = await this.client.session.list(
      this.currentDirectory ? { directory: this.currentDirectory } : undefined,
    )
    return Array.isArray(response.data) ? response.data : []
  }

  async createSession(params?: { parentID?: string; title?: string }): Promise<Session> {
    const directory = this.currentDirectory
    const client = directory ? this.getScopedApiClient(directory) : this.client
    const response = await client.session.create({
      ...(directory ? { directory } : {}),
      parentID: params?.parentID,
      title: params?.title,
    })
    if (response.error) throw new Error(`Failed to create session: ${formatSdkError(response.error)}`)
    if (!response.data) throw new Error("Failed to create session: response did not include session data")
    return response.data
  }

  async getSession(id: string): Promise<Session> {
    const response = await this.client.session.get({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
    })
    if (!response.data) throw new Error("Session not found")
    return response.data
  }

  async deleteSession(id: string): Promise<boolean> {
    const response = await this.client.session.delete({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
    })
    return response.data || false
  }

  async updateSession(id: string, title?: string): Promise<Session> {
    const response = await this.client.session.update({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      title,
    })
    if (!response.data) throw new Error("Failed to update session")
    return response.data
  }

  async getSessionMessages(id: string, limit?: number): Promise<{ info: Message; parts: Part[] }[]> {
    const response = await this.client.session.messages({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      ...(typeof limit === "number" ? { limit } : {}),
    })
    return response.data || []
  }

  async getSessionTodos(
    sessionId: string,
  ): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    try {
      const base = this.baseUrl.replace(/\/+$/, "")
      const path = replacePathParams(API_ENDPOINTS.session.todo, { sessionId })
      const url = new URL(path, `${base}/`)

      if (this.currentDirectory && this.currentDirectory.length > 0) {
        url.searchParams.set("directory", this.currentDirectory)
      }

      const response = await fetch(url.toString(), {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      })

      if (!response.ok) {
        response.body?.cancel()
        return []
      }

      const data = await response.json().catch(() => null)
      if (!data || !Array.isArray(data)) {
        return []
      }

      return data as Array<{ id: string; content: string; status: string; priority: string }>
    } catch {
      return []
    }
  }

  /**
   * Check if MIME type needs normalization to text/plain.
   * Some text MIME types (like text/markdown) aren't supported by AI providers.
   */
  private shouldNormalizeToTextPlain(mime: string): boolean {
    if (!mime) return false

    const lowerMime = mime.toLowerCase()

    // All text/* types except text/plain need normalization
    if (lowerMime.startsWith("text/") && lowerMime !== "text/plain") {
      return true
    }

    // Common application types that are actually text
    const textBasedTypes = [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-yaml",
      "application/yaml",
      "application/toml",
      "application/x-sh",
      "application/x-shellscript",
      "application/octet-stream",
      "image/svg+xml",
    ]

    return textBasedTypes.includes(lowerMime)
  }

  /**
   * Check if MIME type is HEIC/HEIF (iPhone photo format).
   */
  private isHeicMime(mime: string): boolean {
    if (!mime) return false
    const lowerMime = mime.toLowerCase()
    return lowerMime === "image/heic" || lowerMime === "image/heif"
  }

  /**
   * Convert HEIC image to JPEG.
   * Returns the original file if conversion fails.
   */
  private async convertHeicToJpeg(file: {
    mime: string
    filename?: string
    url: string
  }): Promise<{ mime: string; filename?: string; url: string }> {
    try {
      // Dynamic import to avoid loading heic2any unless needed
      const heic2any = (await import("heic2any")).default

      // Extract base64 data from data URL
      const commaIndex = file.url.indexOf(",")
      if (commaIndex === -1) return file

      const base64Data = file.url.substring(commaIndex + 1)
      const binaryString = atob(base64Data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const heicBlob = new Blob([bytes], { type: file.mime })

      // Convert to JPEG
      const jpegBlob = (await heic2any({
        blob: heicBlob,
        toType: "image/jpeg",
        quality: 0.9,
      })) as Blob

      // Convert back to data URL
      const jpegDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(jpegBlob)
      })

      // Update filename extension
      let newFilename = file.filename
      if (newFilename) {
        newFilename = newFilename.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg")
      }

      return {
        mime: "image/jpeg",
        filename: newFilename,
        url: jpegDataUrl,
      }
    } catch (error) {
      console.warn("Failed to convert HEIC to JPEG:", error)
      return file
    }
  }

  /**
   * Normalize file part for sending to AI providers.
   * - Converts unsupported text MIME types to text/plain
   * - Converts HEIC/HEIF images to JPEG
   */
  private async normalizeFilePart(file: {
    mime: string
    filename?: string
    url: string
  }): Promise<{ mime: string; filename?: string; url: string }> {
    // Handle HEIC conversion
    if (this.isHeicMime(file.mime)) {
      return this.convertHeicToJpeg(file)
    }

    // Handle text MIME normalization
    if (!this.shouldNormalizeToTextPlain(file.mime)) {
      return file
    }

    let normalizedUrl = file.url

    // Update MIME type in data URL if present
    // Format: data:<mime>;base64,<content> or data:<mime>,<content>
    if (file.url.startsWith("data:")) {
      const commaIndex = file.url.indexOf(",")
      if (commaIndex !== -1) {
        const meta = file.url.substring(5, commaIndex) // after "data:"
        const content = file.url.substring(commaIndex) // includes comma

        // Replace the MIME type in meta, preserving ;base64 if present
        const newMeta = meta.replace(/^[^;,]+/, "text/plain")
        normalizedUrl = `data:${newMeta}${content}`
      }
    }

    return {
      mime: "text/plain",
      filename: file.filename,
      url: normalizedUrl,
    }
  }

  private async toNormalizedFilePartInput(file: FileInputLite): Promise<FilePartInput> {
    const normalized = await this.normalizeFilePart(file)
    // Only forward `id` when it is a real backend part id. A client-local id
    // (UI key, timestamp, etc.) fails the backend's `prt`-prefix brand and
    // rejects the whole prompt with a 400 "Invalid request"; let the server
    // assign the part id instead.
    return {
      ...(isValidPartId(file.id) ? { id: file.id } : {}),
      type: "file",
      mime: normalized.mime,
      filename: normalized.filename,
      url: normalized.url,
      ...(file.source ? { source: file.source } : {}),
    }
  }

  async sendMessage(params: {
    id: string
    providerID: string
    modelID: string
    text: string
    prefaceText?: string
    prefaceTextSynthetic?: boolean
    agent?: string
    variant?: string
    files?: Array<FileInputLite>
    /** Additional text/file parts to include (for batch sending queued messages) */
    additionalParts?: Array<{
      text: string
      synthetic?: boolean
      files?: Array<FileInputLite>
    }>
    messageId?: string
    agentMentions?: Array<{ name: string; source?: { value: string; start: number; end: number } }>
    format?: {
      type: "json_schema"
      schema: Record<string, unknown>
      retryCount?: number
    }
  }): Promise<string> {
    // Guard against an unselected/stale model. The backend rejects an empty or
    // missing providerID/modelID with an opaque `InvalidRequestError` (400);
    // surfacing a clear, actionable error here protects every caller (the
    // assistant-fork, new-worktree, GitHub-issue, and multi-run-fusion senders
    // do not all guard this themselves) and avoids a confusing 400 round-trip.
    if (!params.providerID || !params.modelID) {
      throw new Error(
        `Cannot send message: no model selected (providerID=${JSON.stringify(params.providerID)}, modelID=${JSON.stringify(params.modelID)}). Choose a provider and model, then retry.`,
      )
    }

    // Reuse one client-side message ID across retries. The server accepts this
    // as the real user message ID, making ambiguous network retries idempotent.
    // A caller-supplied id that is not a valid `msg`-branded id would fail the
    // backend's prompt validation (opaque 400), so fall back to a generated one.
    let messageId = params.messageId ?? ascendingId("msg")
    if (!isValidMessageId(messageId)) {
      console.warn(
        `[prompt] ignoring invalid caller messageId ${JSON.stringify(params.messageId)} (must start with "${MESSAGE_ID_PREFIX}"); generating a valid id`,
      )
      messageId = ascendingId("msg")
    }

    // Build parts array using SDK types (TextPartInput | FilePartInput) plus lightweight agent parts
    const parts: Array<TextPartInput | FilePartInput | AgentPartInputLite> = []

    if (params.prefaceText && params.prefaceText.trim()) {
      parts.push({
        type: "text",
        text: params.prefaceText,
        synthetic: params.prefaceTextSynthetic !== false,
      })
    }

    // Add text part if there's content
    if (params.text && params.text.trim()) {
      const textPart: TextPartInput = {
        type: "text",
        text: params.text,
      }
      parts.push(textPart)
    }

    // Add file parts if provided (normalizing MIME types for compatibility)
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        const filePart = await this.toNormalizedFilePartInput(file)
        parts.push(filePart)
      }
    }

    // Add additional parts (for batch/queued messages)
    if (params.additionalParts && params.additionalParts.length > 0) {
      for (const additional of params.additionalParts) {
        if (additional.text && additional.text.trim()) {
          parts.push({
            type: "text",
            text: additional.text,
            ...(additional.synthetic ? { synthetic: true } : {}),
          })
        }
        if (additional.files && additional.files.length > 0) {
          for (const file of additional.files) {
            const filePart = await this.toNormalizedFilePartInput(file)
            parts.push(filePart)
          }
        }
      }
    }

    if (params.agentMentions && params.agentMentions.length > 0) {
      for (const mention of params.agentMentions) {
        if (!mention?.name) continue
        parts.push({
          type: "agent",
          name: mention.name,
          ...(mention.source ? { source: mention.source } : {}),
        })
      }
    }

    // Ensure we have at least one part
    if (parts.length === 0) {
      throw new Error("Message must have at least one part (text or file)")
    }

    if (this.currentDirectory) {
      await waitForWorktreeBootstrap(this.currentDirectory)
    }

    // Use async prompt endpoint so the client doesn't block waiting
    // for model work (SSE will deliver output/status).
    // This avoids 504s from proxy timeouts on long-running turns.
    const base = this.baseUrl.replace(/\/+$/, "")
    const path = replacePathParams(API_ENDPOINTS.session.promptAsyncForSession, { sessionId: params.id })
    let url: URL
    try {
      url = new URL(path, `${base}/`)
      if (this.currentDirectory) {
        url.searchParams.set("directory", this.currentDirectory)
      }
    } catch (error) {
      console.error("[git-generation][browser] failed to build prompt_async URL", {
        baseUrl: this.baseUrl,
        normalizedBase: base,
        sessionId: params.id,
        directory: this.currentDirectory,
        message: error instanceof Error ? error.message : String(error),
        error,
      })
      throw error
    }

    if (params.format) {
      console.info("[git-generation][browser] send structured message", {
        sessionId: params.id,
        providerID: params.providerID,
        modelID: params.modelID,
        agent: params.agent,
        variant: params.variant,
        directory: this.currentDirectory,
        baseUrl: this.baseUrl,
        formatType: params.format.type,
      })
    }

    assertProviderCircuitClosed(params.providerID)

    const requestBody = {
      model: {
        providerID: params.providerID,
        modelID: params.modelID,
      },
      ...(params.agent ? { agent: params.agent } : {}),
      ...(params.variant ? { variant: params.variant } : {}),
      messageID: messageId,
      ...(params.format ? { format: params.format } : {}),
      parts,
    }
    const requestBodyJson = JSON.stringify(requestBody)

    let response!: Response

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url.toString(), {
          method: HTTP_DEFAULTS.method.post,
          headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
          body: requestBodyJson,
        })
      } catch (error) {
        if (attempt < 2 && isRetryableFetchError(error)) {
          const delay = getRetryDelayMs(attempt)
          console.warn(
            `[prompt] fetch failed for ${params.providerID}/${params.modelID} (attempt ${attempt + 1}/3), retrying in ${delay}ms`,
            (error as Error)?.message,
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        recordProviderError(params.providerID)
        throw error
      }

      if (response.ok) {
        recordProviderSuccess(params.providerID)
        return messageId
      }

      if (shouldRetry(params.providerID, response.status, attempt)) {
        const delay = getRetryDelayMs(attempt)
        console.warn(
          `[prompt] ${response.status} for ${params.providerID}/${params.modelID} (attempt ${attempt + 1}/3), retrying in ${delay}ms`,
        )
        // Release the unread error body before discarding this response on the
        // next iteration — otherwise the stream stays open and leaks the
        // connection (matches the cancel-on-early-return pattern used elsewhere).
        response.body?.cancel().catch(() => {
          /* ignore */
        })
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      let detail = ""
      try {
        detail = await response.text()
      } catch {
        // ignore
      }
      // Instrumentation: the backend's `InvalidRequestError` (400) body carries
      // no field-level detail, so log the exact payload shape that was rejected.
      // Parts are summarized (type + size) instead of dumped to avoid logging
      // large base64 file contents. The id fields are surfaced explicitly and
      // flagged for prefix validity, since a bad `messageID`/part `id` prefix is
      // the most common cause of an opaque "Invalid request" 400.
      console.error("[prompt] send rejected by backend", {
        status: response.status,
        sessionId: params.id,
        directory: this.currentDirectory,
        providerID: params.providerID,
        modelID: params.modelID,
        agent: params.agent ?? null,
        variant: params.variant ?? null,
        messageID: messageId,
        messageIdValid: isValidMessageId(messageId),
        hasFormat: Boolean(params.format),
        parts: parts.map((part) => {
          const id = (part as { id?: unknown }).id
          const idInfo = id === undefined ? {} : { id, idValid: isValidPartId(id) }
          if (part.type === "text") {
            return { type: "text", length: part.text?.length ?? 0, synthetic: part.synthetic ?? false, ...idInfo }
          }
          if (part.type === "file") {
            return { type: "file", mime: part.mime, filename: part.filename, ...idInfo }
          }
          return { type: part.type, name: part.name, ...idInfo }
        }),
        detail,
      })
      const error = new Error(formatPromptSendError(response.status, detail))
      recordProviderError(params.providerID, response.status)
      throw error
    }
    // Defensive fallback — all loop paths return/throw, but TypeScript
    // control flow analysis cannot prove exhaustiveness without this.
    throw new Error("Failed to send message after retries")
  }

  async sendCommand(params: {
    id: string
    providerID: string
    modelID: string
    command: string
    arguments?: string
    agent?: string
    variant?: string
    files?: Array<FileInputLite>
    messageId?: string
  }): Promise<string> {
    const tempMessageId = params.messageId ?? ascendingId("msg")

    const parts: FilePartInput[] = []
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        parts.push(await this.toNormalizedFilePartInput(file))
      }
    }

    const base = this.baseUrl.replace(/\/+$/, "")
    const path = replacePathParams(API_ENDPOINTS.session.commandForSession, { sessionId: params.id })
    const url = new URL(path, `${base}/`)
    if (this.currentDirectory) {
      url.searchParams.set("directory", this.currentDirectory)
    }

    const payload: Record<string, unknown> = {
      command: params.command,
      arguments: params.arguments ?? "",
      model: `${params.providerID}/${params.modelID}`,
      ...(params.agent ? { agent: params.agent } : {}),
      ...(params.variant ? { variant: params.variant } : {}),
      ...(parts.length > 0 ? { parts } : {}),
      messageID: tempMessageId,
    }

    const response = await fetch(url.toString(), {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let detail = ""
      try {
        detail = await response.text()
      } catch {
        // ignore
      }
      const suffix = detail && detail.trim().length > 0 ? `: ${detail.trim()}` : ""
      throw new Error(`Failed to run command (${response.status})${suffix}`)
    }

    return tempMessageId
  }

  async abortSession(id: string): Promise<boolean> {
    const response = await this.client.session.abort(
      {
        sessionID: id,
        ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      },
      { throwOnError: true },
    )
    return Boolean(response.data)
  }

  async revertSession(sessionId: string, messageId: string, partId?: string): Promise<Session> {
    const response = await this.client.session.revert({
      sessionID: sessionId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      messageID: messageId,
      partID: partId,
    })
    if (!response.data) throw new Error("Failed to revert session")
    return response.data
  }

  async unrevertSession(sessionId: string): Promise<Session> {
    const response = await this.client.session.unrevert({
      sessionID: sessionId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
    })
    if (!response.data) throw new Error("Failed to unrevert session")
    return response.data
  }

  async forkSession(sessionId: string, messageId?: string): Promise<Session> {
    const response = await this.client.session.fork({
      sessionID: sessionId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      messageID: messageId,
    })

    if (!response.data) {
      throw new Error("Failed to fork session")
    }

    return response.data
  }

  async getSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return (await this.getSessionStatusForDirectory(this.currentDirectory ?? null)) ?? {}
  }

  /**
   * Returns the upstream `/session/status` map, or `null` if the fetch failed.
   *
   * `null` vs `{}` matters for reconnect resync: the server omits idle sessions
   * from the response, so an empty `{}` means "everything is idle" and a candidate
   * missing from the response is authoritatively idle. A network/HTTP failure must
   * not be conflated with that — return `null` so the caller can preserve state.
   */
  async getSessionStatusForDirectory(
    directory: string | null | undefined,
  ): Promise<Record<
    string,
    { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }
  > | null> {
    try {
      const base = this.baseUrl.replace(/\/+$/, "")
      const url = new URL(API_ENDPOINTS.session.status, `${base}/`)

      const trimmedDirectory = typeof directory === "string" ? directory.trim() : ""
      if (trimmedDirectory.length > 0) {
        url.searchParams.set("directory", trimmedDirectory)
      }

      const response = await fetch(url.toString(), {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      })

      if (!response.ok) {
        response.body?.cancel()
        return null
      }

      const data = await response.json().catch(() => null)
      if (!data || typeof data !== "object") {
        return null
      }

      return data as Record<
        string,
        { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }
      >
    } catch {
      return null
    }
  }

  async getGlobalSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return (await this.getSessionStatusForDirectory(null)) ?? {}
  }

  /**
   * Get session activity from web server's in-memory tracking.
   * This is more reliable than getGlobalSessionStatus on visibility restore
   * because the web server tracks activity even when UI is not listening to SSE.
   */
  async getWebServerSessionActivity(): Promise<Record<string, { type: string }> | null> {
    try {
      // Web server endpoint - use relative path that works with both dev and prod
      const response = await fetch(API_ENDPOINTS.session.activity, {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      })

      if (!response.ok) {
        response.body?.cancel()
        return null
      }

      const data = await response.json().catch(() => null)
      if (!data || typeof data !== "object") {
        return null
      }

      return data as Record<string, { type: string }>
    } catch {
      return null
    }
  }

  // Tools
  async listToolIds(options?: { directory?: string | null }): Promise<string[]> {
    try {
      const directory =
        typeof options?.directory === "string"
          ? options.directory.trim()
          : this.currentDirectory
            ? this.currentDirectory.trim()
            : ""

      const result = await this.client.tool.ids(directory ? { directory } : undefined)
      const tools = (result.data || []) as unknown as string[]
      return tools.filter((tool) => typeof tool === "string" && tool !== "invalid")
    } catch {
      return []
    }
  }

  // Execution modes (autonomous / super-long supervised long-run).
  // These are global settings the server persists to ax-code.json, scoped by
  // directory. Gets return null on failure so callers can distinguish a failed
  // read from an authoritative `false`.
  async getAutonomousEnabled(): Promise<boolean | null> {
    try {
      const result = await this.client.autonomous.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      if (result.error) return null
      return Boolean(result.data?.enabled)
    } catch {
      return null
    }
  }

  async setAutonomousEnabled(enabled: boolean): Promise<boolean | null> {
    try {
      const result = await this.client.autonomous.set({
        enabled,
        ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      })
      if (result.error) return null
      return Boolean(result.data?.enabled)
    } catch {
      return null
    }
  }

  async getSuperLongEnabled(): Promise<boolean | null> {
    try {
      const result = await this.client.superLong.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      if (result.error) return null
      return Boolean(result.data?.enabled)
    } catch {
      return null
    }
  }

  // The server rejects enabling super-long while autonomous is off (409), so
  // callers must enable autonomous first. Returns null on failure.
  async setSuperLongEnabled(enabled: boolean): Promise<boolean | null> {
    try {
      const result = await this.client.superLong.set({
        enabled,
        ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      })
      if (result.error) return null
      return Boolean(result.data?.enabled)
    } catch {
      return null
    }
  }

  // Isolation / sandbox mode. The server persists isolation to ax-code.json
  // scoped by directory. Sandbox is considered "on" when mode is not
  // "full-access" (i.e. "read-only" or "workspace-write").
  async getIsolation(): Promise<{ mode: string; network: boolean } | null> {
    try {
      const result = await this.client.isolation.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      if (result.error || !result.data) return null
      return { mode: result.data.mode, network: result.data.network }
    } catch {
      return null
    }
  }

  async setIsolation(
    mode: "read-only" | "workspace-write" | "full-access",
  ): Promise<{ mode: string; network: boolean } | null> {
    try {
      const result = await this.client.isolation.set({
        mode,
        ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      })
      if (result.error || !result.data) return null
      return { mode: result.data.mode, network: result.data.network }
    } catch {
      return null
    }
  }

  // Permissions
  async replyToPermission(
    requestId: string,
    reply: "once" | "always" | "reject",
    options?: { message?: string },
  ): Promise<boolean> {
    const result = await this.client.permission.reply({
      requestID: requestId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      reply,
      ...(options?.message ? { message: options.message } : {}),
    })
    return result.data || false
  }

  /**
   * Throws on fetch/SDK failure. Callers that drive authoritative state from
   * the result (e.g. reconnect resync) must let the throw propagate so they
   * can preserve existing state instead of conflating "fetch failed" with
   * "server returned no pending permissions".
   */
  async listPendingPermissions(options?: {
    directories?: Array<string | null | undefined>
  }): Promise<PermissionRequest[]> {
    const fetches: Array<Promise<PermissionRequest[]>> = []

    const fetchForDirectory = async (directory?: string | null): Promise<PermissionRequest[]> => {
      const trimmed = typeof directory === "string" ? directory.trim() : ""
      const result = await this.client.permission.list(trimmed ? { directory: trimmed } : undefined)
      if (result.error) {
        throw new Error(`permission.list failed: ${formatSdkError(result.error)}`)
      }
      return (result.data || []) as unknown as PermissionRequest[]
    }

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null))

    const uniqueDirectories = new Set<string>()
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null)
      if (normalized) {
        uniqueDirectories.add(normalized)
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory))
    }

    const results = await Promise.all(fetches)
    const merged: PermissionRequest[] = []
    const seenIds = new Set<string>()

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== "object") continue
        const id = (item as { id?: unknown }).id
        if (typeof id !== "string" || id.length === 0) continue
        if (seenIds.has(id)) continue
        seenIds.add(id)
        merged.push(item)
      }
    }

    return merged
  }

  // Questions ("ask" tool)
  async replyToQuestion(requestId: string, answers: string[] | string[][]): Promise<boolean> {
    const normalizedAnswers: string[][] = (() => {
      if (!Array.isArray(answers) || answers.length === 0) {
        return []
      }
      if (Array.isArray(answers[0])) {
        return answers as string[][]
      }
      return [answers as string[]]
    })()

    const result = await this.client.question.reply({
      requestID: requestId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      answers: normalizedAnswers,
    })
    return result.data || false
  }

  async rejectQuestion(requestId: string): Promise<boolean> {
    const result = await this.client.question.reject({
      requestID: requestId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
    })
    return result.data || false
  }

  /**
   * Throws on fetch/SDK failure. See {@link listPendingPermissions} for
   * rationale — resync paths preserve state on throw via outer try/catch
   * instead of conflating failure with an empty server response.
   */
  async listPendingQuestions(options?: { directories?: Array<string | null | undefined> }): Promise<QuestionRequest[]> {
    const fetches: Array<Promise<QuestionRequest[]>> = []

    const fetchForDirectory = async (directory?: string | null): Promise<QuestionRequest[]> => {
      const trimmed = typeof directory === "string" ? directory.trim() : ""
      const result = await this.client.question.list(trimmed ? { directory: trimmed } : undefined)
      if (result.error) {
        throw new Error(`question.list failed: ${formatSdkError(result.error)}`)
      }
      return (result.data || []) as unknown as QuestionRequest[]
    }

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null))

    const uniqueDirectories = new Set<string>()
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null)
      if (normalized) {
        uniqueDirectories.add(normalized)
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory))
    }

    const results = await Promise.all(fetches)
    const merged: QuestionRequest[] = []
    const seenIds = new Set<string>()

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== "object") continue
        const id = (item as { id?: unknown }).id
        if (typeof id !== "string" || id.length === 0) continue
        if (seenIds.has(id)) continue
        seenIds.add(id)
        merged.push(item)
      }
    }

    return merged
  }

  // Configuration
  async getConfig(): Promise<Config> {
    const response = await this.client.config.get()
    if (!response.data) throw new Error("Failed to get config")
    return response.data
  }

  async updateConfig(config: Record<string, unknown>): Promise<Config> {
    // IMPORTANT: Do NOT pass directory parameter for config updates
    // The config should be global, not directory-specific
    const url = buildAxCodeApiUrl(this.baseUrl, API_ENDPOINTS.config.base)

    const response = await fetch(url, {
      method: HTTP_DEFAULTS.method.patch,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[AxCodeClient] Failed to update config:", response.status, errorText)
      throw new Error(`Failed to update config: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data
  }

  /**
   * Update config with a partial modification function.
   * This handles the GET-modify-PATCH pattern required by the upstream API.
   *
   * NOTE: This method is deprecated for agent configuration.
   * Use backend endpoints at /api/config/agents/* instead, which write directly to files.
   *
   * @param modifier Function that receives current config and returns modified config
   * @returns Updated config from server
   */
  async updateConfigPartial(modifier: (config: Config) => Config): Promise<Config> {
    const currentConfig = await this.getConfig()
    const updatedConfig = modifier(currentConfig)
    const result = await this.updateConfig(updatedConfig)
    return result
  }

  async getProviders(): Promise<{
    providers: Provider[]
    default: { [key: string]: string }
  }> {
    const response = await this.client.config.providers(
      this.currentDirectory ? { directory: this.currentDirectory } : undefined,
    )
    if (!response.data) {
      const errorDetail = response.error ? `: ${JSON.stringify(response.error)}` : ""
      throw new Error(`Failed to get providers${errorDetail}`)
    }
    return response.data
  }

  // App Management - using config endpoint since /app doesn't exist in this version
  async getApp(): Promise<App> {
    // Return basic app info from config
    const config = await this.getConfig()
    return {
      version: "0.0.3", // from the OpenAPI spec
      config,
    }
  }

  async initApp(): Promise<boolean> {
    try {
      // Just check if we can connect since there's no init endpoint
      return await this.checkHealth()
    } catch {
      return false
    }
  }

  // Agent Management
  /**
   * Throws on fetch/SDK failure so caller-side retry loops (see
   * useAgentsStore) can observe failure and retry; silently returning an
   * empty list would defeat retries and clear the cached agent list.
   */
  async listAgents(): Promise<Agent[]> {
    const response = await this.client.app.agents(
      this.currentDirectory ? { directory: this.currentDirectory } : undefined,
    )
    if (response.error) {
      throw new Error(`app.agents failed: ${formatSdkError(response.error)}`)
    }
    return response.data || []
  }

  // SSE infrastructure removed — EventPipeline in sync/event-pipeline.ts handles
  // all SSE event ingestion via the SDK's global.event() async iterator.

  // Command Management
  async listCommands(): Promise<
    Array<{ name: string; description?: string; agent?: string; model?: string; source?: string }>
  > {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      // Return only lightweight info for autocomplete
      return (response.data || []).map((cmd: Record<string, unknown>) => ({
        name: cmd.name as string,
        description: cmd.description as string | undefined,
        agent: cmd.agent as string | undefined,
        model: cmd.model as string | undefined,
        source: cmd.source as string | undefined,
        // Intentionally excluding template to keep memory usage low
      }))
    } catch {
      return []
    }
  }

  async listCommandsWithDetails(): Promise<
    Array<{ name: string; description?: string; agent?: string; model?: string; source?: string; template?: string }>
  > {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      // Return full command details including template
      return (response.data || []).map((cmd: Record<string, unknown>) => ({
        name: cmd.name as string,
        description: cmd.description as string | undefined,
        agent: cmd.agent as string | undefined,
        model: cmd.model as string | undefined,
        source: cmd.source as string | undefined,
        template: cmd.template as string | undefined,
      }))
    } catch {
      return []
    }
  }

  async listSkillsWithDetails(): Promise<
    Array<{ name: string; description?: string; location: string; content?: string }>
  > {
    try {
      const response = await this.client.app.skills(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )
      const data = response.data
      if (!Array.isArray(data)) {
        return []
      }

      const skills: Array<{ name: string; description?: string; location: string; content?: string }> = []
      for (const item of data as Array<Record<string, unknown>>) {
        const name = typeof item.name === "string" ? item.name.trim() : ""
        const location = typeof item.location === "string" ? item.location : ""
        if (!name || !location) {
          continue
        }
        const skill: { name: string; description?: string; location: string; content?: string } = { name, location }
        if (typeof item.description === "string") skill.description = item.description
        if (typeof item.content === "string") skill.content = item.content
        skills.push(skill)
      }
      return skills
    } catch {
      return []
    }
  }

  async getCommandDetails(
    name: string,
  ): Promise<{ name: string; template: string; description?: string; agent?: string; model?: string } | null> {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      )

      if (response.data) {
        const command = response.data.find((cmd: Record<string, unknown>) => cmd.name === name)
        if (command) {
          return {
            name: command.name as string,
            template: command.template as string,
            description: command.description as string | undefined,
            agent: command.agent as string | undefined,
            model: command.model as string | undefined,
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  // Health Check - using /health endpoint for detailed status
  async checkHealth(): Promise<boolean> {
    try {
      // Health endpoint is at root, not under /api
      let healthUrl: string
      const normalizedBase = this.baseUrl.endsWith("/") ? this.baseUrl.replace(/\/+$/, "") : this.baseUrl
      if (normalizedBase === API_PATHS.base) {
        healthUrl = API_ENDPOINTS.debug.rootHealth
      } else if (normalizedBase.endsWith(API_PATHS.base)) {
        // Desktop: http://127.0.0.1:PORT/api -> http://127.0.0.1:PORT/health
        healthUrl = `${normalizedBase.slice(0, -API_PATHS.base.length) || "/"}${API_ENDPOINTS.debug.rootHealth}`
      } else {
        healthUrl = `${normalizedBase}${API_ENDPOINTS.debug.rootHealth}`
      }
      const response = await fetch(healthUrl)
      if (!response.ok) {
        response.body?.cancel()
        return false
      }

      const healthData = await response.json()

      // Check if the upstream API is ready (not just OpenChamber server)
      if (healthData.isAxCodeReady === false) {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  // File System Operations
  async createDirectory(
    dirPath: string,
    options?: { allowOutsideWorkspace?: boolean },
  ): Promise<{ success: boolean; path: string }> {
    const desktopFiles = getDesktopFilesApi()
    if (desktopFiles?.createDirectory) {
      try {
        const result = await desktopFiles.createDirectory(dirPath, options)
        if (result?.success) {
          this.invalidateListDirectoryCacheForPath(result.path || dirPath)
        }
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(message || "Failed to create directory")
      }
    }

    const payload = {
      path: dirPath,
      ...(options?.allowOutsideWorkspace ? { allowOutsideWorkspace: true } : {}),
    }

    const response = await fetch(buildAxCodeApiUrl(this.baseUrl, API_ENDPOINTS.fs.mkdir), {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to create directory" }))
      throw new Error(error.error || "Failed to create directory")
    }

    const result = await response.json()
    if (result?.success) {
      this.invalidateListDirectoryCacheForPath(result.path || dirPath)
    }
    return result
  }

  async cloneRepository(input: {
    remoteUrl: string
    destinationPath: string
    gitIdentityId?: string | null
  }): Promise<{ success: boolean; path: string; output?: string }> {
    const response = await fetch(buildAxCodeApiUrl(this.baseUrl, API_ENDPOINTS.fs.clone), {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Failed to clone repository" }))
      throw new Error(error.error || "Failed to clone repository")
    }

    const result = await response.json()
    if (result?.success) {
      this.invalidateListDirectoryCacheForPath(result.path || input.destinationPath)
    }
    return result
  }

  async listLocalDirectory(
    directoryPath: string | null | undefined,
    options?: { respectGitignore?: boolean },
  ): Promise<FilesystemEntry[]> {
    const normalizedDirectoryPath = typeof directoryPath === "string" ? normalizeFsPath(directoryPath.trim()) : ""
    const cacheKey = `${normalizedDirectoryPath}|${options?.respectGitignore ? "1" : "0"}`
    const now = Date.now()
    const cached = this.listDirectoryCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.entries
    }

    const inFlight = this.listDirectoryInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const cacheGeneration = this.listDirectoryCacheGeneration
    const task = (async () => {
      const desktopFiles = getDesktopFilesApi()
      if (desktopFiles) {
        try {
          const result = await desktopFiles.listDirectory(directoryPath || "", options)
          if (!result || !Array.isArray(result.entries)) {
            return []
          }
          const entries = result.entries.map<FilesystemEntry>((entry) => ({
            name: entry.name,
            path: normalizeFsPath(entry.path),
            isDirectory: !!entry.isDirectory,
            isFile: !entry.isDirectory,
            isSymbolicLink: false,
          }))
          if (cacheGeneration === this.listDirectoryCacheGeneration) {
            this.listDirectoryCache.set(cacheKey, {
              entries,
              expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
            })
          }
          return entries
        } catch (error) {
          console.error("Failed to list directory contents:", error)
          throw error
        }
      }

      try {
        const params = new URLSearchParams()
        if (directoryPath && directoryPath.trim().length > 0) {
          params.set("path", directoryPath)
        }
        if (options?.respectGitignore) {
          params.set("respectGitignore", "true")
        }
        const query = params.toString()
        const response = await fetch(
          `${buildAxCodeApiUrl(this.baseUrl, API_ENDPOINTS.fs.list)}${query ? `?${query}` : ""}`,
        )
        if (!response.ok) {
          const error = await response.json().catch(() => ({}))
          const message = typeof error.error === "string" ? error.error : "Failed to list directory"
          throw new Error(message)
        }

        const result = await response.json()
        if (!result || !Array.isArray(result.entries)) {
          return []
        }

        const entries = result.entries as FilesystemEntry[]
        if (cacheGeneration === this.listDirectoryCacheGeneration) {
          this.listDirectoryCache.set(cacheKey, {
            entries,
            expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
          })
        }
        return entries
      } catch (error) {
        console.error("Failed to list directory contents:", error)
        throw error
      }
    })()

    const trackedTask = task.finally(() => {
      if (this.listDirectoryInFlight.get(cacheKey) === trackedTask) {
        this.listDirectoryInFlight.delete(cacheKey)
      }
    })
    this.listDirectoryInFlight.set(cacheKey, trackedTask)
    return trackedTask
  }

  async searchFiles(
    query: string,
    options?: {
      directory?: string | null
      limit?: number
      includeHidden?: boolean
      respectGitignore?: boolean
      dirs?: boolean
      type?: "file" | "directory"
    },
  ): Promise<ProjectFileSearchHit[]> {
    const directory =
      typeof options?.directory === "string" && options.directory.trim().length > 0
        ? options.directory.trim()
        : this.currentDirectory
    const normalizedDirectory = directory ? normalizeFsPath(directory) : null
    const scopedClient = directory ? this.getScopedApiClient(directory) : this.client

    try {
      const response = await scopedClient.find.files({
        query,
        limit: typeof options?.limit === "number" && Number.isFinite(options.limit) ? options.limit : undefined,
        dirs: !(options?.dirs === false || options?.type === "file"),
        type: options?.type,
      })

      const items = Array.isArray(response?.data) ? response.data : []
      return items.map<ProjectFileSearchHit>((item) => {
        const normalizedRelativePath = normalizeFsPath(item)
        const name = normalizedRelativePath.split("/").filter(Boolean).pop() || normalizedRelativePath
        const normalizedPath = normalizedDirectory
          ? normalizeFsPath(`${normalizedDirectory}/${normalizedRelativePath}`)
          : normalizeFsPath(normalizedRelativePath)

        return {
          name,
          path: normalizedPath,
          relativePath: normalizedRelativePath,
          extension: name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined,
        }
      })
    } catch (error) {
      console.error("Failed to search files:", error)
      throw error
    }
  }

  async getFilesystemHome(): Promise<string | null> {
    // Optimization: Check for desktop runtime first to avoid unnecessary network calls
    // and fix the "SyntaxError" warning when the endpoint is missing
    const desktopHome = await getDesktopHomeDirectory()
    if (desktopHome) {
      return desktopHome
    }

    try {
      const response = await fetch(buildAxCodeApiUrl(this.baseUrl, API_ENDPOINTS.fs.home), {
        method: HTTP_DEFAULTS.method.get,
        headers: HTTP_DEFAULTS.headers.acceptJson,
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        const message =
          typeof error.error === "string" && error.error.length > 0 ? error.error : "Failed to resolve home directory"
        throw new Error(message)
      }

      const payload = await response.json()
      if (payload && typeof payload.home === "string" && payload.home.length > 0) {
        return payload.home
      }
      return null
    } catch (error) {
      console.warn("Failed to resolve filesystem home directory:", error)
      return null
    }
  }

  async setAxCodeWorkingDirectory(directoryPath: string | null | undefined): Promise<DirectorySwitchResult | null> {
    if (!directoryPath || typeof directoryPath !== "string" || !directoryPath.trim()) {
      console.warn("[AxCodeClient] setAxCodeWorkingDirectory: invalid path", directoryPath)
      return null
    }

    const url = buildAxCodeApiUrl(this.baseUrl, API_ENDPOINTS.session.directory)
    console.log("[AxCodeClient] POST", url, "with path:", directoryPath)

    try {
      const response = await fetch(url, {
        method: HTTP_DEFAULTS.method.post,
        headers: HTTP_DEFAULTS.headers.contentTypeJson,
        body: JSON.stringify({ path: directoryPath }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const error = payload ?? {}
        const message =
          typeof error.error === "string" && error.error.length > 0
            ? error.error
            : "Failed to update ax-code working directory"
        throw new Error(message)
      }

      if (payload && typeof payload === "object") {
        return payload as DirectorySwitchResult
      }

      return {
        success: true,
        restarted: false,
        path: directoryPath,
      }
    } catch (error) {
      console.warn("Failed to update ax-code working directory:", error)
      throw error
    }
  }
}

// Exported singleton instance
export const axCodeClient = new AxCodeService()

// Exported types
export type { Session, Message, Part, Provider, Config, Model }
export type { App }
