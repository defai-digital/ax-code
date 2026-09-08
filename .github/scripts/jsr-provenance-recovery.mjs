import assert from "node:assert/strict"
import { createHash, X509Certificate } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"

const packageName = "@defai-digital/ax-code-sdk"
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const readJson = async (file) => new Response(await fs.readFile(file)).json()

export function versionFromTag(tag) {
  assert.match(tag, /^sdk-v\d+\.\d+\.\d+$/)
  return tag.slice(5)
}

export function needsAttestation(metadata, version, now = Date.now()) {
  assert.equal(metadata?.scope, "defai-digital")
  assert.equal(metadata.package, "ax-code-sdk")
  assert.equal(metadata.version, version)
  assert.equal(metadata.yanked, false)
  if (typeof metadata.rekorLogId === "string" && /^\d+$/.test(metadata.rekorLogId)) return false
  assert.equal(metadata.rekorLogId, null, "Invalid provenance metadata")
  const age = now - Date.parse(metadata.createdAt)
  // JSR only updates provenance within two minutes of publication. Reserve
  // thirty seconds for signing and attachment, then fail instead of a no-op.
  assert(Number.isFinite(age) && age >= -5000 && age < 90000, "JSR provenance attachment window expired")
  return true
}

export async function expectedFiles(root, tag) {
  const sdk = path.join(root, "packages/sdk/js")
  const source = await readJson(path.join(sdk, "package.json"))
  const config = await readJson(path.join(sdk, "jsr.json"))
  const version = versionFromTag(tag)
  assert.equal(source.version, version)
  assert.equal(config.version, version)
  assert.equal(config.name, packageName)
  const files = new Map()
  async function visit(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name)
      if (item.isDirectory()) {
        await visit(file)
        continue
      }
      assert(item.isFile(), `Unexpected non-file: ${file}`)
      let bytes = await fs.readFile(file)
      if (file.endsWith(".js")) {
        const declaration = file.replace(/\.js$/, ".d.ts")
        await fs.access(declaration)
        const text = bytes.toString("utf8")
        if (!text.startsWith("/* @ts-self-types=")) {
          bytes = Buffer.from(`/* @ts-self-types="./${path.basename(declaration)}" */\n${text}`)
        }
      }
      files.set(`/${path.relative(sdk, file).split(path.sep).join("/")}`, bytes)
    }
  }
  await visit(path.join(sdk, "dist"))
  for (const name of ["README.md", "ARCHITECTURE.md", "jsr.json"]) {
    files.set(`/${name}`, await fs.readFile(path.join(sdk, name)))
  }
  files.set("/LICENSE", await fs.readFile(path.join(root, "LICENSE")))
  const workspace = await fs.readFile(path.join(root, "pnpm-workspace.yaml"), "utf8")
  const dependencies = {}
  for (const [name, specifier] of Object.entries(source.dependencies)) {
    assert.equal(typeof specifier, "string")
    if (specifier === "catalog:") {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const match = workspace.match(new RegExp(`^  ["']${escaped}["']:\\s*["']([^"']+)["']$`, "m"))
      assert(match, `Missing catalog entry: ${name}`)
      dependencies[name] = match[1]
    } else {
      assert(!/^(?:workspace|file|link):/.test(specifier))
      dependencies[name] = specifier
    }
  }
  const settings = await fs.readFile(path.join(sdk, "script/jsr-package-settings.ts"), "utf8")
  const description = settings.match(/^export const JSR_DESCRIPTION = "([^"\n]+)"$/m)?.[1]
  assert(description, "Missing SDK package description")
  const publicManifest = {
    name: packageName,
    version,
    description,
    type: "module",
    license: "Apache-2.0",
    engines: { node: ">=24" },
    repository: { type: "git", url: "https://github.com/defai-digital/ax-code.git", directory: "packages/sdk/js" },
    dependencies,
  }
  files.set("/package.json", Buffer.from(`${JSON.stringify(publicManifest, null, 2)}\n`))
  // Deno resolves module specifiers before uploading, including declaration targets.
  const ts = createRequire(path.join(path.resolve(root), "package.json"))("typescript")
  for (const [name, bytes] of files) {
    if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue
    const text = bytes.toString("utf8")
    const sourceFile = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
    const edits = []
    function visit(node) {
      const literal =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined
      if (literal && ts.isStringLiteral(literal)) {
        const specifier = literal.text
        let resolved = specifier
        if (dependencies[specifier]) resolved = `npm:${specifier}@${dependencies[specifier]}`
        else if (name.endsWith(".d.ts") && specifier.startsWith(".") && specifier.endsWith(".js")) {
          const declaration = specifier.replace(/\.js$/, ".d.ts")
          if (files.has(path.posix.resolve(path.posix.dirname(name), declaration))) resolved = declaration
        }
        if (resolved !== specifier)
          edits.push({ start: literal.getStart(sourceFile) + 1, end: literal.end - 1, resolved })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    let transformed = text
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      transformed = transformed.slice(0, edit.start) + edit.resolved + transformed.slice(edit.end)
    }
    files.set(name, Buffer.from(transformed))
  }
  return files
}

export async function verifyManifest(bytes, files) {
  const metadata = await new Response(bytes).json()
  assert(metadata && typeof metadata.manifest === "object" && !Array.isArray(metadata.manifest))
  assert.deepEqual(Object.keys(metadata.manifest).sort(), [...files.keys()].sort(), "Published file set differs")
  for (const [name, contents] of files) {
    assert.equal(metadata.manifest[name].size, contents.length, `Published size differs: ${name}`)
    assert.equal(metadata.manifest[name].checksum, `sha256-${digest(contents)}`, `Published checksum differs: ${name}`)
  }
  return digest(bytes)
}

export async function toJsrBundle(bundle, version, manifestDigest) {
  versionFromTag(`sdk-v${version}`)
  const envelope = bundle.dsseEnvelope
  assert.equal(envelope?.payloadType, "application/vnd.in-toto+json")
  assert.equal(envelope.signatures?.length, 1)
  const statement = await new Response(Buffer.from(envelope.payload, "base64")).json()
  assert.deepEqual(statement.subject, [
    { name: `pkg:jsr/${packageName}@${version}`, digest: { sha256: manifestDigest } },
  ])
  const material = bundle.verificationMaterial
  const certificate = material.certificate ?? material.x509CertificateChain?.certificates?.[0]
  assert.equal(typeof certificate?.rawBytes, "string")
  assert(certificate.rawBytes.length > 0)
  const pem = new X509Certificate(
    certificate.rawBytes.startsWith("-----BEGIN CERTIFICATE-----")
      ? certificate.rawBytes
      : Buffer.from(certificate.rawBytes, "base64"),
  ).toString()
  assert.equal(material.tlogEntries?.length, 1)
  const logIndex = Number(material.tlogEntries[0].logIndex)
  assert(Number.isSafeInteger(logIndex) && logIndex >= 0)
  assert.equal(typeof envelope.signatures[0].sig, "string")
  assert(envelope.signatures[0].sig.length > 0)
  return {
    mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.1",
    content: {
      $case: "dsseEnvelope",
      dsseEnvelope: { ...envelope, signatures: [{ keyid: "", sig: envelope.signatures[0].sig }] },
    },
    verificationMaterial: {
      content: { $case: "x509CertificateChain", x509CertificateChain: { certificates: [{ rawBytes: pem }] } },
      tlogEntries: [{ logIndex }],
    },
  }
}
