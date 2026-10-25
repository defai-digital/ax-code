import { createHash, randomBytes } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import semver from "semver"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Config } from "../config/config"
import { AxEnginePaths } from "../provider/ax-engine/paths"
import { getDependencyStatus } from "../provider/ax-engine/dependency"
import { HfCache } from "../provider/ax-engine/hf-cache"
import { FileLock } from "../util/filelock"
import { Process } from "../util/process"
import { withTimeout } from "../util/timeout"
import { readBoundedBody } from "../util/http-body"
import { parseJsonStrict } from "../util/json-value"

export const WIKI_EMBEDDING_MODEL = {
  repo: "AutomatosX/AX-Qwen3-Embedding-0.6B-MLX-AXQ-MXFP8",
  revision: "a3a669490a7976a27563a2bfdd2c30be850c2e8c",
  dimensions: 1024,
  files: {
    "model.safetensors": "4ff6f3b73633a5194cf0ba50b944789466eb47a4a2b199f5db8944a566fd22d8",
    "config.json": "b49450c5c373f46fa637822bbbd466ada245fb3b58c40e589d41a8932070670f",
    "tokenizer.json": "93623af029cdc69b87f2864d3b2cc2424fdf16684f15e139b5b9d08ec34ced91",
    "tokenizer_config.json": "d93ac1a2c7adb9ad022f354d822f1f0f57e32e62ef2989e902782d6ab896acfe",
    "model.safetensors.index.json": "6ec8c2db4004f31b9d945957229ba7619a59734e07778e42e70c4b583880a88f",
    "model-manifest.json": "ef0838b96ca6ffe2a60d7ac8d29ce2a4f8899e2789bd918cf674f5dc5ce8ded6",
    "generation_config.json": "28396d421a2108acce96383f6a7de78008f7f1b17f807958f3c14c51dbfb65fb",
    "axquant_runtime.json": "dc081a4bc7a53380af2a1da969b971ea0f3ea6b9f0218a526538d4b81ea76c3e",
    "chat_template.jinja": "87a2728cb8dc9fe424d624542f6060ec05a1d285ebbec578bb078900e33396b5",
  },
} as const

export type WikiEmbeddingWorker = {
  embed(texts: string[]): Promise<number[][]>
  close(): Promise<void>
}

export const WikiEmbeddingCleanupError = NamedError.create(
  "WikiEmbeddingCleanupError",
  z.object({ message: z.string() }),
)

const ResponseSchema = z.object({
  data: z.array(
    z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()).length(1024) }),
  ),
})

export function parseWikiEmbeddings(value: unknown, count: number): number[][] {
  const { data } = ResponseSchema.parse(value)
  if (data.length !== count || new Set(data.map((row) => row.index)).size !== count)
    throw new Error("Invalid Wiki embedding batch")
  return [...data]
    .sort((a, b) => a.index - b.index)
    .map((row, index) => {
      const norm = Math.hypot(...row.embedding)
      if (row.index !== index || !Number.isFinite(norm) || norm < 1e-12)
        throw new Error("Invalid Wiki embedding vector")
      return row.embedding.map((v) => v / norm)
    })
}

/** Check actual bytes, not a completion marker left by a partial download. */
export async function verifyWikiEmbeddingFiles(
  directory: string,
  signal: AbortSignal,
  cacheRoot = directory,
): Promise<boolean> {
  try {
    const root = await realpath(cacheRoot)
    if (
      (await readdir(directory)).some(
        (name) => (name.endsWith(".safetensors") && name !== "model.safetensors") || name === "special_tokens_map.json",
      )
    )
      return false
    for (const [name, expected] of Object.entries(WIKI_EMBEDDING_MODEL.files)) {
      signal.throwIfAborted()
      // Hub snapshots link into their own blobs directory. Permit only those
      // resolved targets, and still verify every byte against the immutable pin.
      const target = await realpath(path.join(directory, name))
      const relative = path.relative(root, target)
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const before = await file.stat()
        if (!before.isFile()) return false
        const hash = createHash("sha256")
        for await (const chunk of file.createReadStream({ autoClose: false })) {
          signal.throwIfAborted()
          hash.update(chunk)
        }
        if (hash.digest("hex") !== expected) return false
        const after = await file.stat()
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          (await realpath(path.join(directory, name))) !== target
        )
          return false
      } finally {
        await file.close()
      }
    }
    return true
  } catch {
    signal.throwIfAborted()
    return false
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else if (address && typeof address !== "string") resolve(address.port)
        else reject(new Error("No Wiki embedding port"))
      })
    })
  })
}

/** Called only inside idle maintenance, never from bootstrap or a status read. */
export async function openWikiEmbeddingWorker(
  signal: AbortSignal,
  runtime: {
    verify?: typeof verifyWikiEmbeddingFiles
  } = {},
): Promise<WikiEmbeddingWorker | undefined> {
  if (process.platform !== "darwin" || process.arch !== "arm64") return undefined
  signal.throwIfAborted()
  // This small worker has its own admission budget, independent of chat's 32 GiB floor.
  if (os.totalmem() < 8 * 1024 ** 3 || os.freemem() < 2 * 1024 ** 3) return undefined
  const config = await Config.get()
  if (config.disabled_providers?.includes("ax-engine")) return undefined
  const dependency = await getDependencyStatus(config.provider?.["ax-engine"]?.options ?? {})
  signal.throwIfAborted()
  if (
    !dependency.available ||
    !dependency.binaryPath ||
    !semver.valid(dependency.version) ||
    semver.lt(dependency.version!, "7.9.0")
  )
    return undefined
  const power = await Process.text(["pmset", "-g", "batt"], { timeout: 2000, abort: signal, nothrow: true })
  signal.throwIfAborted()
  if (power.code !== 0 || !power.text.includes("AC Power")) return undefined
  const lease = await FileLock.tryAcquire(path.join(AxEnginePaths.root, "wiki-embedding-worker"), {
    staleMs: 15 * 60_000,
    signal,
  })
  if (!lease) return undefined
  let child: Process.Child | undefined
  const lifetime = new AbortController()
  let closing: Promise<void> | undefined
  const close = () => {
    if (closing) return closing
    lifetime.abort(new DOMException("Wiki embedding worker closed", "AbortError"))
    closing = (async () => {
      if (child?.pid !== undefined) {
        try {
          await Process.killProcessTree(child)
          await withTimeout(child.exited, 3000, "Wiki embedding worker did not exit")
        } catch {
          try {
            await Process.killProcessTree(child, { signal: "SIGKILL" })
            await withTimeout(child.exited, 3000, "Wiki embedding worker did not exit after SIGKILL")
          } catch (cause) {
            // Do not release admission or proceed to generation with a live worker.
            throw new WikiEmbeddingCleanupError({ message: "Wiki embedding worker cleanup failed" }, { cause })
          }
        }
      }
      lease[Symbol.dispose]()
    })()
    return closing
  }
  try {
    const cache = HfCache.repoDir(WIKI_EMBEDDING_MODEL.repo)
    const directory = path.join(cache, "snapshots", WIKI_EMBEDDING_MODEL.revision)
    const verify = runtime.verify ?? verifyWikiEmbeddingFiles
    const env = { ...process.env }
    if (!(await verify(directory, signal, cache))) {
      const downloaded = await Process.text(
        [dependency.binaryPath, "download", `${WIKI_EMBEDDING_MODEL.repo}@${WIKI_EMBEDDING_MODEL.revision}`, "--json"],
        { env, abort: signal, timeout: 90_000, nothrow: true },
      )
      signal.throwIfAborted()
      if (downloaded.code !== 0 || !(await verify(directory, signal, cache)))
        throw new Error("Wiki embedding artifact verification failed")
    }
    const port = await unusedPort()
    const token = randomBytes(32).toString("hex")
    child = Process.spawn(
      [
        dependency.binaryPath,
        "serve",
        directory,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--offline",
        "--",
        "--model-id",
        "qwen3_embedding",
        "--max-concurrent-requests",
        "1",
        "--total-blocks",
        "128",
        "--block-size-tokens",
        "16",
      ],
      { env: { ...env, AX_ENGINE_API_KEY: token }, abort: signal, timeout: 120_000 },
    )
    // Node reports asynchronous spawn errors through exited without assigning
    // a PID. Surface that error and release admission: no process needs reaping.
    if (child.pid === undefined) {
      await child.exited
      throw new Error("Wiki embedding worker did not start")
    }
    const embed = async (texts: string[]) => {
      signal.throwIfAborted()
      lifetime.signal.throwIfAborted()
      if (texts.length < 1 || texts.length > 4 || texts.some((text) => !text.trim() || Buffer.byteLength(text) > 4096))
        throw new Error("Wiki embedding input exceeds batch limits")
      const response = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(15_000)]),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: "qwen3_embedding", input: texts, pooling: "last", normalize: true }),
      })
      if (!response.ok) {
        // Readiness may retry. Release the unread response instead of holding
        // its connection until the whole worker lifetime ends.
        void response.body?.cancel().catch(() => {})
        throw new Error("Wiki embedding request failed")
      }
      const body = await readBoundedBody(response, 256 * 1024)
      return parseWikiEmbeddings(parseJsonStrict(Buffer.from(body).toString("utf8")), texts.length)
    }
    // Authenticated model request is the readiness check: an unrelated listener
    // winning the ephemeral-port race cannot be mistaken for our worker.
    const deadline = Date.now() + 30_000
    while (true) {
      signal.throwIfAborted()
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Wiki embedding worker exited")
      try {
        await embed(["Wiki embedding readiness"])
        break
      } catch {
        signal.throwIfAborted()
        if (Date.now() >= deadline) throw new Error("Wiki embedding worker readiness timeout")
        await delay(250, undefined, { signal })
      }
    }
    return { embed, close }
  } catch (error) {
    await close()
    throw error
  }
}
