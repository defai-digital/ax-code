#!/usr/bin/env node

import { createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"

const API_VERSION = "2022-11-28"
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000]

export function selectReleaseByTag(releases, tag) {
  const matches = releases.filter((release) => release?.tag_name === tag)
  if (matches.length === 0) throw new Error(`release ${tag} was not found`)
  if (matches.length > 1) throw new Error(`release ${tag} is ambiguous (${matches.length} matches)`)
  return matches[0]
}

export function releaseUploadUrl(release, assetName) {
  const template = release?.upload_url
  if (typeof template !== "string" || template.length === 0) {
    throw new Error("release upload_url is missing")
  }
  return `${template.replace(/\{.*$/, "")}?name=${encodeURIComponent(assetName)}`
}

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(status)
}

export function matchingUploadedAsset(assets, name, size) {
  return assets.find((asset) => asset?.name === name && asset?.size === size)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function responseError(response, body) {
  const suffix = body.trim() ? `: ${body.trim().slice(0, 1_000)}` : ""
  return new Error(`GitHub API ${response.status} ${response.statusText}${suffix}`)
}

export async function githubRequest(url, init = {}, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleepImpl = options.sleepImpl ?? sleep
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const log = options.log ?? console.warn
  const headers = new Headers(init.headers)
  headers.set("Accept", headers.get("Accept") ?? "application/vnd.github+json")
  headers.set("Authorization", headers.get("Authorization") ?? `Bearer ${options.token ?? ""}`)
  headers.set("User-Agent", headers.get("User-Agent") ?? "ax-code-release-assets")
  headers.set("X-GitHub-Api-Version", headers.get("X-GitHub-Api-Version") ?? API_VERSION)

  let attempt = 0
  while (true) {
    let response
    try {
      response = await fetchImpl(url, { ...init, headers })
    } catch (error) {
      if (attempt >= retryDelaysMs.length) throw error
      const delay = retryDelaysMs[attempt++]
      log(`GitHub request failed before a response; retrying in ${delay}ms (${attempt}/${retryDelaysMs.length})`)
      await sleepImpl(delay)
      continue
    }

    if (response.ok) return response

    const body = await response.text()
    if (!isRetryableStatus(response.status) || attempt >= retryDelaysMs.length) {
      throw responseError(response, body)
    }

    const retryAfter = response.headers.get("retry-after")
    const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter)
    const delay =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1_000 : retryDelaysMs[attempt]
    attempt += 1
    log(`GitHub API returned ${response.status}; retrying in ${delay}ms (${attempt}/${retryDelaysMs.length})`)
    await sleepImpl(delay)
  }
}

function apiUrl(repo, suffix) {
  return `https://api.github.com/repos/${repo}${suffix}`
}

async function responseJson(response) {
  const text = await response.text()
  return text ? JSON.parse(text) : undefined
}

export async function findRelease({
  repo,
  tag,
  token,
  request = githubRequest,
  notFoundRetryDelaysMs = [],
  sleepImpl = sleep,
  log = console.warn,
}) {
  for (let attempt = 0; ; attempt += 1) {
    const releases = []
    for (let page = 1; page <= 10; page += 1) {
      const response = await request(apiUrl(repo, `/releases?per_page=100&page=${page}`), {}, { token })
      const batch = await responseJson(response)
      if (!Array.isArray(batch)) throw new Error("GitHub releases response was not an array")
      releases.push(...batch)
      if (batch.length < 100) break
    }

    const matches = releases.filter((release) => release?.tag_name === tag)
    if (matches.length > 0) return selectReleaseByTag(matches, tag)
    if (attempt >= notFoundRetryDelaysMs.length) return selectReleaseByTag(matches, tag)

    const delay = notFoundRetryDelaysMs[attempt]
    log(`Release ${tag} is not visible yet; retrying in ${delay}ms (${attempt + 1}/${notFoundRetryDelaysMs.length})`)
    await sleepImpl(delay)
  }
}

export async function createRelease({ repo, tag, token, name = tag, notes, prerelease = false }) {
  try {
    const response = await githubRequest(
      apiUrl(repo, "/releases"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_name: tag,
          name,
          body: notes,
          draft: true,
          prerelease,
          generate_release_notes: notes === undefined,
        }),
      },
      { token },
    )
    const release = await responseJson(response)
    console.log(`Created draft ${release?.html_url ?? tag}`)
    return release
  } catch (error) {
    // A create request can succeed server-side while its response is lost. If
    // the retry then reports that the release already exists, reconcile it by
    // tag and continue only when it is still an unpublished draft.
    let release
    try {
      release = await findRelease({ repo, tag, token, notFoundRetryDelaysMs: DEFAULT_RETRY_DELAYS_MS })
    } catch {
      throw error
    }
    requireDraft(release)
    console.warn(`Create response for ${tag} failed, but GitHub stored the draft release`)
    return release
  }
}

function requireDraft(release) {
  if (release.draft !== true) {
    throw new Error(`release ${release.tag_name ?? release.id} is already published; refusing to mutate its assets`)
  }
}

async function retryPipeline(factory, destination, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  const temporary = `${destination}.partial`
  for (let attempt = 0; ; attempt += 1) {
    await rm(temporary, { force: true })
    try {
      const response = await factory()
      if (!response.body) throw new Error("GitHub asset response had no body")
      await pipeline(response.body, createWriteStream(temporary, { flags: "wx" }))
      await rename(temporary, destination)
      return
    } catch (error) {
      await rm(temporary, { force: true })
      if (attempt >= retryDelaysMs.length) throw error
      const delay = retryDelaysMs[attempt]
      console.warn(`Asset download failed; retrying in ${delay}ms (${attempt + 1}/${retryDelaysMs.length})`)
      await sleep(delay)
    }
  }
}

export async function downloadReleaseAssets({ repo, tag, token, directory }) {
  const release = await findRelease({ repo, tag, token, notFoundRetryDelaysMs: DEFAULT_RETRY_DELAYS_MS })
  await mkdir(directory, { recursive: true })
  const seen = new Set()

  for (const asset of release.assets ?? []) {
    const name = path.basename(asset.name ?? "")
    if (!name || name !== asset.name) throw new Error(`release asset has an unsafe name: ${asset.name ?? ""}`)
    if (seen.has(name)) throw new Error(`release contains duplicate asset name: ${name}`)
    seen.add(name)
    const destination = path.join(directory, name)
    await rm(destination, { force: true })
    await retryPipeline(
      () => githubRequest(asset.url, { headers: { Accept: "application/octet-stream" } }, { token }),
      destination,
    )
    console.log(`Downloaded ${name}`)
  }

  if (seen.size === 0) throw new Error(`release ${tag} has no assets`)
  return release
}

export async function uploadReleaseAssets({ repo, tag, token, files }) {
  const release = await findRelease({ repo, tag, token, notFoundRetryDelaysMs: DEFAULT_RETRY_DELAYS_MS })
  requireDraft(release)
  const assets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]))

  for (const file of files) {
    const name = path.basename(file)
    const existing = assets.get(name)
    if (existing) {
      await githubRequest(apiUrl(repo, `/releases/assets/${existing.id}`), { method: "DELETE" }, { token })
      assets.delete(name)
    }

    const body = await readFile(file)
    let uploaded
    try {
      const response = await githubRequest(
        releaseUploadUrl(release, name),
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "Content-Type": "application/octet-stream",
          },
          body,
        },
        { token },
      )
      uploaded = await responseJson(response)
    } catch (error) {
      // GitHub can persist an upload and still return a transient 5xx. A retry
      // then reports "already_exists" even though the desired final state was
      // reached. Reconcile by name and byte size before treating it as failed.
      const assetsResponse = await githubRequest(
        apiUrl(repo, `/releases/${release.id}/assets?per_page=100`),
        {},
        { token },
      )
      const currentAssets = await responseJson(assetsResponse)
      uploaded = Array.isArray(currentAssets) ? matchingUploadedAsset(currentAssets, name, body.byteLength) : undefined
      if (!uploaded) throw error
      console.warn(`Upload response for ${name} failed, but GitHub stored the complete ${body.byteLength}-byte asset`)
    }
    assets.set(name, uploaded)
    console.log(`Uploaded ${name}`)
  }

  return release
}

export async function publishRelease({ repo, tag, token }) {
  const release = await findRelease({ repo, tag, token, notFoundRetryDelaysMs: DEFAULT_RETRY_DELAYS_MS })
  requireDraft(release)
  const response = await githubRequest(
    apiUrl(repo, `/releases/${release.id}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: false }),
    },
    { token },
  )
  const published = await responseJson(response)
  console.log(`Published ${published?.html_url ?? tag}`)
  return published
}

function parseCli(argv) {
  const [command, ...rest] = argv
  const values = { command, files: [] }
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]
    if (
      value === "--repo" ||
      value === "--tag" ||
      value === "--dir" ||
      value === "--name" ||
      value === "--notes-file"
    ) {
      const next = rest[index + 1]
      if (!next) throw new Error(`${value} requires a value`)
      values[value.slice(2)] = next
      index += 1
      continue
    }
    if (value === "--prerelease") {
      values.prerelease = true
      continue
    }
    if (value.startsWith("--")) throw new Error(`unknown option: ${value}`)
    values.files.push(value)
  }
  return values
}

function usage() {
  return [
    "Usage:",
    "  node script/github-release-assets.mjs inspect --repo owner/repo --tag <tag>",
    "  node script/github-release-assets.mjs create --repo owner/repo --tag <tag> [--name <name>] [--notes-file <file>] [--prerelease]",
    "  node script/github-release-assets.mjs download --repo owner/repo --tag <tag> --dir <directory>",
    "  node script/github-release-assets.mjs upload --repo owner/repo --tag <tag> <file>...",
    "  node script/github-release-assets.mjs publish --repo owner/repo --tag <tag>",
  ].join("\n")
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseCli(argv)
  if (!options.command || !options.repo || !options.tag) throw new Error(usage())
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) throw new Error(`invalid repository: ${options.repo}`)
  const token = env.GH_TOKEN || env.GITHUB_TOKEN
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required")

  if (options.command === "inspect") {
    const release = await findRelease({ repo: options.repo, tag: options.tag, token })
    console.log(JSON.stringify({ id: release.id, tag: release.tag_name, draft: release.draft, url: release.html_url }))
    return
  }
  if (options.command === "create") {
    const notes = options["notes-file"] ? await readFile(options["notes-file"], "utf8") : undefined
    await createRelease({
      repo: options.repo,
      tag: options.tag,
      token,
      name: options.name ?? options.tag,
      notes,
      prerelease: options.prerelease === true,
    })
    return
  }
  if (options.command === "download") {
    if (!options.dir) throw new Error("download requires --dir")
    await downloadReleaseAssets({ repo: options.repo, tag: options.tag, token, directory: options.dir })
    return
  }
  if (options.command === "upload") {
    if (options.files.length === 0) throw new Error("upload requires at least one file")
    await uploadReleaseAssets({ repo: options.repo, tag: options.tag, token, files: options.files })
    return
  }
  if (options.command === "publish") {
    await publishRelease({ repo: options.repo, tag: options.tag, token })
    return
  }
  throw new Error(`unknown command: ${options.command}\n${usage()}`)
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
