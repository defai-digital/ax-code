import { expect, test } from "vitest"
import { TrustReview, redactArgv, trustReview } from "../../src/mcp/trust-review"
import { credentialLike, maskedCredentialValue } from "../../src/util/credential-value"

test("JWT-shaped fixtures are masked in reviews but remain admissible browser input", () => {
  const jwt = ["fixtureHeader", "fixturePayload", "fixtureSignature"].join(".")
  expect(credentialLike(jwt)).toBe(false)
  expect(maskedCredentialValue(jwt)).toBe(true)
  expect(redactArgv(["server", jwt, `--fixture=${jwt}`])).toEqual({
    argv: ["server", "[redacted]", "--fixture=[redacted]"],
    redacted: true,
  })
})

test("credential matching preserves embedded secrets and publishable-key exceptions", () => {
  const secret = ["sk", "live", "0123456789abcdefghij"].join("_")
  const publishable = ["pk", "live", "0123456789abcdefghij"].join("_")
  for (const value of [secret, `my_${secret}`, `prefix ${secret} suffix`]) {
    expect(credentialLike(value)).toBe(true)
    expect(maskedCredentialValue(value)).toBe(true)
    expect(redactArgv([value])).toEqual({ argv: ["[redacted]"], redacted: true })
  }
  for (const value of [publishable, `ta${secret}`, "ordinary fixture text"]) {
    expect(credentialLike(value)).toBe(false)
    expect(maskedCredentialValue(value)).toBe(false)
    expect(redactArgv([value])).toEqual({ argv: [value], redacted: false })
  }
})

test("argv URL redaction handles inline values, repeated keys, fragments and malformed URLs", () => {
  const argv = Object.freeze([
    "server",
    "--endpoint=https://user:password@example.com/api?team=first&team=second#fragment",
    "https://[invalid?token=fixture",
    "--port=4000",
  ])
  expect(redactArgv(argv)).toEqual({
    argv: ["server", "--endpoint=https://[redacted]@example.com/api?team=[redacted]", "[redacted]", "--port=4000"],
    redacted: true,
  })
  expect(argv[1]).toContain("team=second#fragment")
})

test("review payloads use the shared schema and never mutate the config", () => {
  const config = {
    type: "local" as const,
    command: ["node", "server.js", "--token", "fixture-value"],
    environment: { ZONE: "eu", API_TOKEN: "fixture-secret" },
  }
  const original = structuredClone(config)
  const review = trustReview(config)
  expect(TrustReview.parse(review)).toEqual({
    transport: "local",
    command: ["node", "server.js", "--token", "[redacted]"],
    environmentKeys: ["API_TOKEN", "ZONE"],
    redacted: true,
  })
  expect(config).toEqual(original)
})

test("the remote review keeps origin and path and the names of query keys and headers only", () => {
  const review = trustReview({
    type: "remote",
    url: "https://mcp.example.com/v1/sse?api_key=abc123#frag",
    headers: { Authorization: "Bearer zzz", "X-Team": "core" },
  })
  expect(review).toEqual({
    transport: "remote",
    url: "https://mcp.example.com/v1/sse",
    queryKeys: ["api_key"],
    headerKeys: ["Authorization", "X-Team"],
  })
  expect(JSON.stringify(review)).not.toMatch(/abc123|Bearer|core|frag/)

  const withUser = trustReview({ type: "remote", url: "https://user:pass@mcp.example.com/x" })
  expect(withUser).toEqual({ transport: "remote", url: "https://mcp.example.com/x", hasCredentials: true })
  expect(JSON.stringify(withUser)).not.toMatch(/user|pass/)

  // A URL that does not parse is never echoed back.
  expect(trustReview({ type: "remote", url: "not a url ?token=x" } as never)).toEqual({ transport: "remote" })
})

// Credential-shaped fixtures are assembled at run time so the repository's secret scan never sees a literal.
const FAKE_STRIPE_KEY = ["sk", "live", "0123456789abcdefghij"].join("-")
const FAKE_GITHUB_TOKEN = ["ghp", "0123456789abcdefghijklmnop"].join("_")
const FAKE_DSN = ["postgres://", "u:p", "@db.internal:5432/app"].join("")

test("redactArgv hides secret flag values, credential-shaped arguments and URL secrets", () => {
  const shown = redactArgv([
    "server",
    `--api-key=${FAKE_STRIPE_KEY}`,
    "--token",
    "plain-looking-value",
    "--dsn",
    FAKE_DSN,
    FAKE_GITHUB_TOKEN,
    "https://hooks.example.com/notify?secret=fixture-value",
    "--port",
    "4000",
  ])
  expect(shown.redacted).toBe(true)
  expect(shown.argv).toEqual([
    "server",
    "--api-key=[redacted]",
    "--token",
    "[redacted]",
    "--dsn",
    "[redacted]",
    "[redacted]",
    "https://hooks.example.com/notify?secret=[redacted]",
    "--port",
    "4000",
  ])
  expect(redactArgv(["node", "server.js", "--port", "4000"])).toEqual({
    argv: ["node", "server.js", "--port", "4000"],
    redacted: false,
  })
})

test("a WebMCP entry is reviewed by its profile and the argv it actually launches", () => {
  const review = trustReview({
    type: "local",
    command: ["echo", "harmless"],
    webmcp: { allowedOrigins: ["https://app.example.com"], executablePath: "/opt/chrome/bin/chrome", read: true },
  } as never)
  expect(review.transport).toBe("local")
  if (review.transport !== "local") return
  expect(review.webmcp).toMatchObject({
    allowedOrigins: ["https://app.example.com"],
    executablePath: "/opt/chrome/bin/chrome",
    read: true,
  })
  expect(review.command).not.toEqual(["echo", "harmless"])
  expect(review.command?.join(" ")).toContain("chrome-devtools-mcp")
})
