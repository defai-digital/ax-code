import { mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import { createHash, randomUUID } from "node:crypto"
import * as path from "path"

export interface DownloadResult {
  content?: Buffer
  filePath?: string
  error?: string
}

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

async function fetchContent(source: string): Promise<Buffer> {
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`Failed to fetch from ${source}: ${response.statusText}`)
  }
  const advertisedSize = response.headers.get("content-length")
  if (advertisedSize !== null && (!/^\d+$/.test(advertisedSize) || Number(advertisedSize) > MAX_DOWNLOAD_BYTES)) {
    await response.body.cancel()
    throw new Error("Parser download exceeds size limit")
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  let complete = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        complete = true
        break
      }
      size += value.byteLength
      if (size > MAX_DOWNLOAD_BYTES) throw new Error("Parser download exceeds size limit")
      chunks.push(Buffer.from(value))
    }
    if (size === 0) throw new Error("Parser download is empty")
    return Buffer.concat(chunks, size)
  } finally {
    if (!complete) await reader.cancel()
    reader.releaseLock()
  }
}

async function writeAtomic(target: string, content: Buffer): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: "wx" })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

export class DownloadUtils {
  private static hashUrl(url: string): string {
    return createHash("sha256").update(url).digest("hex")
  }

  /**
   * Download a file from URL or load from local path, with caching support
   */
  static async downloadOrLoad(
    source: string,
    cacheDir: string,
    cacheSubdir: string,
    fileExtension: string,
    useHashForCache: boolean = true,
    filetype?: string,
  ): Promise<DownloadResult> {
    const isUrl = source.startsWith("http://") || source.startsWith("https://")

    if (isUrl) {
      let cacheFileName: string
      if (useHashForCache) {
        const hash = this.hashUrl(source)
        cacheFileName = filetype ? `${encodeURIComponent(filetype)}-${hash}${fileExtension}` : `${hash}${fileExtension}`
      } else {
        cacheFileName = path.basename(new URL(source).pathname)
      }
      const cacheFile = path.join(cacheDir, cacheSubdir, cacheFileName)

      // Ensure cache directory exists
      try {
        await mkdir(path.dirname(cacheFile), { recursive: true })
      } catch (error) {
        return { error: `Cannot create parser cache: ${error}` }
      }

      try {
        const cachedContent = await readFile(cacheFile)
        if (cachedContent.byteLength > 0) {
          console.log(`Loaded from cache: ${cacheFile} (${source})`)
          return { content: cachedContent, filePath: cacheFile }
        }
      } catch (error) {
        // Cache miss, continue to fetch
      }

      try {
        console.log(`Downloading from URL: ${source}`)
        const content = await fetchContent(source)

        try {
          await writeAtomic(cacheFile, content)
          console.log(`Cached: ${source}`)
        } catch (cacheError) {
          console.warn(`Failed to cache: ${cacheError}`)
          return { content }
        }

        return { content, filePath: cacheFile }
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` }
      }
    } else {
      try {
        console.log(`Loading from local path: ${source}`)
        const content = await readFile(source)
        return { content, filePath: source }
      } catch (error) {
        return { error: `Error loading from local path ${source}: ${error}` }
      }
    }
  }

  /**
   * Download and save a file to a specific target path
   */
  static async downloadToPath(source: string, targetPath: string): Promise<DownloadResult> {
    const isUrl = source.startsWith("http://") || source.startsWith("https://")

    try {
      await mkdir(path.dirname(targetPath), { recursive: true })
    } catch (error) {
      return { error: `Cannot create download directory: ${error}` }
    }

    if (isUrl) {
      try {
        console.log(`Downloading from URL: ${source}`)
        const content = await fetchContent(source)

        await writeAtomic(targetPath, content)
        console.log(`Downloaded: ${source} -> ${targetPath}`)

        return { content, filePath: targetPath }
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` }
      }
    } else {
      try {
        console.log(`Copying from local path: ${source}`)
        const content = await readFile(source)
        await writeAtomic(targetPath, content)
        return { content, filePath: targetPath }
      } catch (error) {
        return { error: `Error copying from local path ${source}: ${error}` }
      }
    }
  }

  /**
   * Fetch multiple highlight queries and concatenate them
   */
  static async fetchHighlightQueries(sources: string[], cacheDir: string, filetype: string): Promise<string> {
    const queryPromises = sources.map((source) => this.fetchHighlightQuery(source, cacheDir, filetype))
    const queryResults = await Promise.all(queryPromises)

    const validQueries = queryResults.filter((query) => query.trim().length > 0)
    return validQueries.join("\n")
  }

  private static async fetchHighlightQuery(source: string, cacheDir: string, filetype: string): Promise<string> {
    const result = await this.downloadOrLoad(source, cacheDir, "queries", ".scm", true, filetype)

    if (result.error) {
      console.error(`Error fetching highlight query from ${source}:`, result.error)
      return ""
    }

    if (result.content) {
      return new TextDecoder().decode(result.content)
    }

    return ""
  }
}
