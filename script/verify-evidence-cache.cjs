const assert = require("node:assert/strict")
const { createHash, randomBytes } = require("node:crypto")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

async function verifyEvidenceCache(modulePath) {
  const { openEvidenceStore } = require(path.resolve(modulePath))
  assert.equal(typeof openEvidenceStore, "function", "RocksDB evidence support is missing")
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-evidence-probe-")))
  const directory = path.join(root, "db")
  const payload = randomBytes(64).toString("hex")
  const key = createHash("sha256").update(payload).digest("hex")
  let store
  try {
    store = await openEvidenceStore(directory)
    await store.put(key, payload)
    assert.equal(await store.get(key), payload, "Evidence write/read mismatch")
    await store.close()
    store = undefined
    store = await openEvidenceStore(directory)
    assert.equal(await store.get(key), payload, "Evidence did not survive close/reopen")
    return { verified: true, backend: "rocksdb", platform: process.platform, arch: process.arch, node: process.version }
  } finally {
    try {
      await store?.close()
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  }
}

module.exports = { verifyEvidenceCache }

if (require.main === module) {
  const timer = setTimeout(() => {
    console.error("Evidence cache verification timed out")
    process.exit(1)
  }, 20_000)
  verifyEvidenceCache(process.argv[2] || "packages/ax-code-fs-native")
    .then(
      (result) => console.log(JSON.stringify(result)),
      (error) => {
        console.error(`Evidence cache verification failed: ${error.message}`)
        process.exitCode = 1
      },
    )
    .finally(() => clearTimeout(timer))
}
