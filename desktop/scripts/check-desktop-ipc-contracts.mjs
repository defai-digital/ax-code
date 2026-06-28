#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const desktopRoot = path.resolve(import.meta.dirname, "..")
const uiRoot = path.join(desktopRoot, "packages", "ui", "src")
const electronRoot = path.join(desktopRoot, "packages", "electron", "src")
const electronMain = path.join(electronRoot, "main.js")
const contractFile = path.join(electronRoot, "desktop-ipc-contract.json")
const preload = path.join(electronRoot, "preload.js")

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const allowedArgContracts = new Set(["none", "object"])
const ignoredPathPattern = /(^|\/)(__tests__|dist|node_modules)\//
const testFilePattern = /\.(test|spec)\.[cm]?[jt]sx?$/

const handlerPattern = /\bhandleCommand\s*\(\s*["'](desktop_[A-Za-z0-9_]+)["']/g
const invokePatterns = [
  /\b(?:invokeDesktop|invokeDesktopCommand|invoke|ipcRenderer\.invoke)\s*(?:<[^>()]+>)?\s*\(\s*["'](desktop_[A-Za-z0-9_]+)["']/g,
  /\btauri\?\.\s*core\?\.\s*invoke\?\.?\s*(?:<[^>()]+>)?\s*\(\s*["'](desktop_[A-Za-z0-9_]+)["']/g,
  /\btauri\.\s*core\.\s*invoke\s*(?:<[^>()]+>)?\s*\(\s*["'](desktop_[A-Za-z0-9_]+)["']/g,
]

function toRelative(file) {
  return path.relative(desktopRoot, file).split(path.sep).join("/")
}

function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relative = toRelative(fullPath)
    if (ignoredPathPattern.test(relative)) continue

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath))
      continue
    }

    if (testFilePattern.test(entry.name)) continue
    if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath)
  }

  return files
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length
}

function extractCall(source, start) {
  let depth = 0
  let quote = null
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char
      continue
    }
    if (char === "(") depth += 1
    else if (char === ")") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  return source.slice(start)
}

function collectHandlerContracts() {
  const source = readFileSync(electronMain, "utf8")
  const handlers = new Map()
  const callPattern = /\bhandleCommand\s*\(/g

  for (const match of source.matchAll(callPattern)) {
    const call = extractCall(source, (match.index ?? 0) + "handleCommand".length)
    const command = call.match(/^\(\s*["'](desktop_[A-Za-z0-9_]+)["']/)?.[1]
    if (!command) continue
    handlers.set(command, {
      command,
      safeForRemote: /safeForRemote\s*:\s*true/.test(call),
      location: `${toRelative(electronMain)}:${lineNumberAt(source, match.index ?? 0)}`,
    })
  }

  return handlers
}

function loadManifest() {
  const parsed = JSON.parse(readFileSync(contractFile, "utf8"))
  const failures = []
  if (parsed?.version !== 1) failures.push("version must be 1")
  if (!Array.isArray(parsed?.commands)) failures.push("commands must be an array")

  const commands = new Map()
  for (const [index, entry] of (parsed.commands ?? []).entries()) {
    const prefix = `commands[${index}]`
    if (!entry || typeof entry !== "object") {
      failures.push(`${prefix} must be an object`)
      continue
    }
    if (typeof entry.command !== "string" || !/^desktop_[A-Za-z0-9_]+$/.test(entry.command)) {
      failures.push(`${prefix}.command must be a desktop_* string`)
    }
    if (typeof entry.safeForRemote !== "boolean") {
      failures.push(`${prefix}.safeForRemote must be boolean`)
    }
    if (!allowedArgContracts.has(entry.args)) {
      failures.push(`${prefix}.args must be one of: ${[...allowedArgContracts].join(", ")}`)
    }
    if (commands.has(entry.command)) {
      failures.push(`${prefix}.command duplicates ${entry.command}`)
    }
    commands.set(entry.command, entry)
  }

  return { commands, failures }
}

function collectHandlers() {
  const source = readFileSync(electronMain, "utf8")
  const handlers = new Set()

  for (const match of source.matchAll(handlerPattern)) {
    handlers.add(match[1])
  }

  return handlers
}

function collectInvokes() {
  const files = [...collectFiles(uiRoot), preload].sort()
  const invokes = new Map()

  for (const file of files) {
    const source = readFileSync(file, "utf8")
    for (const pattern of invokePatterns) {
      for (const match of source.matchAll(pattern)) {
        const command = match[1]
        if (!command) continue
        const hits = invokes.get(command) ?? []
        hits.push(`${toRelative(file)}:${lineNumberAt(source, match.index ?? 0)}`)
        invokes.set(command, hits)
      }
    }
  }

  return invokes
}

const { commands: manifest, failures: manifestFailures } = loadManifest()
const handlerContracts = collectHandlerContracts()
const handlers = collectHandlers()
const invokes = collectInvokes()
const missingHandlers = [...invokes.keys()].filter((command) => !handlers.has(command)).sort()
const invokedWithoutManifest = [...invokes.keys()].filter((command) => !manifest.has(command)).sort()
const handlerWithoutManifest = [...handlers].filter((command) => !manifest.has(command)).sort()
const manifestWithoutHandler = [...manifest.keys()].filter((command) => !handlers.has(command)).sort()
const safeForRemoteMismatches = [...manifest.values()]
  .map((entry) => {
    const handler = handlerContracts.get(entry.command)
    if (!handler || handler.safeForRemote === entry.safeForRemote) return null
    return {
      command: entry.command,
      manifest: entry.safeForRemote,
      handler: handler.safeForRemote,
      location: handler.location,
    }
  })
  .filter(Boolean)

if (
  manifestFailures.length > 0 ||
  missingHandlers.length > 0 ||
  invokedWithoutManifest.length > 0 ||
  handlerWithoutManifest.length > 0 ||
  manifestWithoutHandler.length > 0 ||
  safeForRemoteMismatches.length > 0
) {
  console.error("Desktop IPC contract check failed.")
  for (const failure of manifestFailures) {
    console.error(`- manifest: ${failure}`)
  }
  for (const command of missingHandlers) {
    console.error(`- ${command} has no Electron handler`)
    for (const location of invokes.get(command) ?? []) {
      console.error(`  ${location}`)
    }
  }
  for (const command of invokedWithoutManifest) {
    console.error(`- ${command} is invoked but missing from ${toRelative(contractFile)}`)
  }
  for (const command of handlerWithoutManifest) {
    console.error(`- ${command} has a handler but is missing from ${toRelative(contractFile)}`)
  }
  for (const command of manifestWithoutHandler) {
    console.error(`- ${command} is listed in ${toRelative(contractFile)} but has no handler`)
  }
  for (const mismatch of safeForRemoteMismatches) {
    console.error(
      `- ${mismatch.command} safeForRemote mismatch: manifest=${mismatch.manifest}, handler=${mismatch.handler} (${mismatch.location})`,
    )
  }
  process.exit(1)
}

console.log(
  `Desktop IPC contract check passed (${invokes.size} invoked command(s), ${handlers.size} handler(s), ${manifest.size} manifest command(s)).`,
)
