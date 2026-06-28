import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const script = path.join(repoRoot, "scripts/minisign-artifacts.sh")
const pinnedPublicKey = "RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A"

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-desktop-minisign-test-"))
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function writeFakeCommandEnv(
  fixture,
  {
    unameBody = "printf 'Linux\\n'",
    securityBody = "return 1",
  } = {},
) {
  fs.writeFileSync(
    fixture.bashEnv,
    `
minisign() {
  local sig=""
  local mode="sign"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -V) mode="verify"; shift ;;
      -x) sig="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [ "$mode" = "sign" ] && [ -n "$sig" ]; then
    local stdin
    stdin="$(cat || true)"
    if [ -n "$stdin" ]; then
      printf '%s' "$stdin" >> ${shellQuote(fixture.stdinLog)}
    fi
    printf 'fake signature\\n' > "$sig"
  fi
}

uname() {
  ${unameBody}
}

security() {
  ${securityBody}
}
`,
  )
}

function createFixture() {
  const dir = makeTempDir()
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin)

  const secretKey = path.join(dir, "ax-code-desktop.minisign.key")
  const publicKey = path.join(dir, "ax-code-desktop.minisign.pub")
  const asset = path.join(dir, "asset.zip")
  const stdinLog = path.join(dir, "minisign-stdin.log")
  const bashEnv = path.join(dir, "fake-commands.sh")

  fs.writeFileSync(secretKey, "secret")
  fs.chmodSync(secretKey, 0o600)
  fs.writeFileSync(
    publicKey,
    ["untrusted comment: minisign public key 5B7AB63CD6D674BE", pinnedPublicKey, ""].join("\n"),
  )
  fs.writeFileSync(asset, "asset")

  const fixture = { dir, bin, secretKey, publicKey, asset, stdinLog, bashEnv }
  writeFakeCommandEnv(fixture)

  return fixture
}

function runScript(args, fixture, env = {}) {
  return spawnSync("bash", [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "",
    timeout: 5000,
    env: {
      ...process.env,
      SIGNKEY_DIR: "",
      AX_CODE_DESKTOP_MINISIGN_SECRET_KEY: "",
      MINISIGN_SECRET_KEY: "",
      AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY: "",
      MINISIGN_PUBLIC_KEY: "",
      AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY_STRING: "",
      AX_CODE_DESKTOP_MINISIGN_PINNED_PUBLIC_KEY: "",
      AX_CODE_DESKTOP_MINISIGN_TRUSTED_COMMENT: "",
      MINISIGN_TRUSTED_COMMENT: "",
      AX_CODE_DESKTOP_MINISIGN_UNTRUSTED_COMMENT: "",
      MINISIGN_UNTRUSTED_COMMENT: "",
      AX_CODE_DESKTOP_MINISIGN_PASSWORD: "",
      MINISIGN_PASSWORD: "",
      AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_SERVICE: "",
      AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_ACCOUNT: "",
      BASH_ENV: fixture.bashEnv,
      PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? ""}`,
      ...env,
    },
  })
}

describe("minisign-artifacts.sh", () => {
  test("rejects a public key that does not match the pinned release key", () => {
    const fixture = createFixture()
    try {
      fs.writeFileSync(
        fixture.publicKey,
        [
          "untrusted comment: minisign public key 0000000000000000",
          "RW00000000000000000000000000000000000000000000000000000000000",
          "",
        ].join("\n"),
      )

      const result = runScript(
        ["--secret-key", fixture.secretKey, "--public-key", fixture.publicKey, fixture.asset],
        fixture,
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("does not match the pinned AX Code Desktop release key")
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(false)
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test("passes explicit minisign password to the signing command", () => {
    const fixture = createFixture()
    try {
      const result = runScript(
        ["--secret-key", fixture.secretKey, "--public-key", fixture.publicKey, fixture.asset],
        fixture,
        { AX_CODE_DESKTOP_MINISIGN_PASSWORD: "from-env" },
      )

      expect(result.status).toBe(0)
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(true)
      expect(fs.readFileSync(fixture.stdinLog, "utf8")).toBe("from-env")
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test("uses macOS Keychain passphrase when no password env is set", () => {
    const fixture = createFixture()
    try {
      writeFakeCommandEnv(fixture, {
        unameBody: "printf 'Darwin\\n'",
        securityBody: `
if [ "$1" = "find-generic-password" ]; then
  printf 'from-keychain\\n'
  return 0
fi
return 1
`,
      })

      const result = runScript(
        ["--secret-key", fixture.secretKey, "--public-key", fixture.publicKey, fixture.asset],
        fixture,
      )

      expect(result.status).toBe(0)
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(true)
      expect(fs.readFileSync(fixture.stdinLog, "utf8")).toBe("from-keychain")
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test("writes signatures to --signature-dir", () => {
    const fixture = createFixture()
    try {
      const sigDir = path.join(fixture.dir, "sigs")
      const result = runScript(
        [
          "--secret-key",
          fixture.secretKey,
          "--public-key",
          fixture.publicKey,
          "--signature-dir",
          sigDir,
          fixture.asset,
        ],
        fixture,
        { AX_CODE_DESKTOP_MINISIGN_PASSWORD: "pw" },
      )

      expect(result.status).toBe(0)
      expect(fs.existsSync(path.join(sigDir, "asset.zip.minisig"))).toBe(true)
      // signature is not written beside the artifact
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(false)
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test("verifies with --public-key-string and no public key file", () => {
    const fixture = createFixture()
    try {
      const missingPub = path.join(fixture.dir, "does-not-exist.pub")
      const result = runScript(
        [
          "--secret-key",
          fixture.secretKey,
          "--public-key",
          missingPub,
          "--public-key-string",
          pinnedPublicKey,
          fixture.asset,
        ],
        fixture,
        { AX_CODE_DESKTOP_MINISIGN_PASSWORD: "pw" },
      )

      expect(result.status).toBe(0)
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(true)
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test("--keychain-service/--keychain-account route the Keychain lookup", () => {
    const fixture = createFixture()
    try {
      writeFakeCommandEnv(fixture, {
        unameBody: "printf 'Darwin\\n'",
        securityBody: `
if [ "$1" = "find-generic-password" ]; then
  svc=""; acct=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -s) svc="$2"; shift 2 ;;
      -a) acct="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  printf 'kc:%s/%s\\n' "$svc" "$acct"
  return 0
fi
return 1
`,
      })

      const result = runScript(
        [
          "--secret-key",
          fixture.secretKey,
          "--public-key",
          fixture.publicKey,
          "--keychain-service",
          "custom-svc",
          "--keychain-account",
          "custom-acct",
          fixture.asset,
        ],
        fixture,
      )

      expect(result.status).toBe(0)
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(true)
      expect(fs.readFileSync(fixture.stdinLog, "utf8")).toBe("kc:custom-svc/custom-acct")
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test("--pinned-public-key override accepts a matching non-default key", () => {
    const fixture = createFixture()
    try {
      const altKey = "RW00000000000000000000000000000000000000000000000000000000000"
      fs.writeFileSync(
        fixture.publicKey,
        ["untrusted comment: minisign public key 0000000000000000", altKey, ""].join("\n"),
      )

      const result = runScript(
        [
          "--secret-key",
          fixture.secretKey,
          "--public-key",
          fixture.publicKey,
          "--pinned-public-key",
          altKey,
          fixture.asset,
        ],
        fixture,
        { AX_CODE_DESKTOP_MINISIGN_PASSWORD: "pw" },
      )

      expect(result.status).toBe(0)
      expect(fs.existsSync(`${fixture.asset}.minisig`)).toBe(true)
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
})
