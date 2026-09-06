import crypto from "node:crypto"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

/**
 * JSR package settings that the registry scores independently of a published
 * version: description, runtime compatibility, and README source. GitHub OIDC
 * can publish versions but cannot PATCH these fields; a scope member must
 * apply them once (this script) and CI then checks the public score API.
 */

export const JSR_SCOPE = "defai-digital"
export const JSR_PACKAGE = "ax-code-sdk"
export const JSR_DESCRIPTION = "TypeScript SDK for the AX Code coding-agent runtime"
export const JSR_README_SOURCE = "readme" as const
export const JSR_RUNTIME_COMPAT = {
  node: true,
  deno: false,
  bun: null,
  browser: false,
  workerd: false,
} as const

const API = "https://api.jsr.io"
const USER_AGENT = "ax-code-sdk-settings/2.3.0; https://github.com/defai-digital/ax-code"
const args = process.argv.slice(2)

type JsonObject = Record<string, unknown>

type PackageScore = {
  hasDescription: boolean
  atLeastOneRuntimeCompatible: boolean
  multipleRuntimesCompatible: boolean
  total: number
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  })
  const text = await response.text()
  let body: unknown = text
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as JsonObject
}

function stringField(value: JsonObject, field: string): string {
  const entry = value[field]
  if (typeof entry !== "string" || !entry) throw new Error(`Missing ${field}`)
  return entry
}

async function fetchScore(): Promise<PackageScore> {
  const { status, body } = await api(`/scopes/${JSR_SCOPE}/packages/${JSR_PACKAGE}/score`)
  if (status !== 200) throw new Error(`Score API returned ${status}: ${JSON.stringify(body)}`)
  const score = asObject(body, "score")
  return {
    hasDescription: score.hasDescription === true,
    atLeastOneRuntimeCompatible: score.atLeastOneRuntimeCompatible === true,
    multipleRuntimesCompatible: score.multipleRuntimesCompatible === true,
    total: typeof score.total === "number" ? score.total : 0,
  }
}

export function assertJsrScoreMetadata(score: PackageScore): void {
  const missing: string[] = []
  if (!score.hasDescription) missing.push("description")
  if (!score.atLeastOneRuntimeCompatible) missing.push("at least one compatible runtime")
  if (missing.length > 0) {
    throw new Error(
      `JSR package settings are incomplete (${missing.join(", ")}). ` +
        `A scope member must run \`pnpm --dir packages/sdk/js run apply:jsr-settings\` ` +
        `or set them at https://jsr.io/@${JSR_SCOPE}/${JSR_PACKAGE}/settings.`,
    )
  }
}

async function checkScore(): Promise<void> {
  const score = await fetchScore()
  console.log(JSON.stringify(score, null, 2))
  assertJsrScoreMetadata(score)
  console.log(`JSR score metadata is complete (total=${score.total})`)
}

function openUrl(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const argv = process.platform === "win32" ? ["/c", "start", url] : [url]
  spawn(command, argv, { detached: true, stdio: "ignore" }).unref()
}

async function authorize(): Promise<string> {
  const verifier = crypto.randomBytes(32).toString("base64url")
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
  const created = await api("/authorizations", {
    method: "POST",
    body: JSON.stringify({ challenge }),
  })
  if (created.status !== 200) {
    throw new Error(`Create authorization failed (${created.status}): ${JSON.stringify(created.body)}`)
  }
  const auth = asObject(created.body, "authorization")
  const verificationUrl = stringField(auth, "verificationUrl")
  const code = typeof auth.code === "string" ? auth.code : ""
  const exchangeToken = stringField(auth, "exchangeToken")
  const pollInterval = typeof auth.pollInterval === "number" ? auth.pollInterval : 2
  const approveUrl = code && !verificationUrl.includes(code) ? `${verificationUrl}?code=${encodeURIComponent(code)}` : verificationUrl
  console.log(`Approve JSR access: ${approveUrl}`)
  if (code) console.log(`Authorization code: ${code}`)
  openUrl(approveUrl)

  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000))
    const exchanged = await api("/authorizations/exchange", {
      method: "POST",
      body: JSON.stringify({ exchangeToken, verifier }),
    })
    if (exchanged.status === 200) {
      return stringField(asObject(exchanged.body, "exchange"), "token")
    }
    if (exchanged.status !== 400 && exchanged.status !== 401 && exchanged.status !== 404) {
      throw new Error(`Authorization exchange failed (${exchanged.status}): ${JSON.stringify(exchanged.body)}`)
    }
  }
  throw new Error("Timed out waiting for JSR authorization")
}

async function patchPackage(token: string, payload: JsonObject): Promise<void> {
  const { status, body } = await api(`/scopes/${JSR_SCOPE}/packages/${JSR_PACKAGE}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  if (status !== 200) {
    throw new Error(`Update package failed (${status}): ${JSON.stringify(body)}`)
  }
}

async function applySettings(): Promise<void> {
  const token = await authorize()
  await patchPackage(token, { description: JSR_DESCRIPTION })
  await patchPackage(token, { runtimeCompat: JSR_RUNTIME_COMPAT })
  await patchPackage(token, { readmeSource: JSR_README_SOURCE })
  await checkScore()
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (args.includes("--check")) {
    await checkScore()
  } else {
    await applySettings()
  }
}
