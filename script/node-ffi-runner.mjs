#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { prepareNodeArgs, splitNodeLaunchArgs } from "./node-ffi-runner-args.mjs"
import {
  AX_CODE_SPAWN_ARGV0,
  axCodeJobTitleOsc,
  brandedSpawnOptions,
  resolveBrandedNodePath,
} from "./node-ffi-runner-brand.mjs"

// Keep macOS argv intact: process.title clears argument storage while the
// kernel retains argc, so terminal job-title readers can mistake environment
// entries for arguments. The branded executable and OSC titles name the TUI.
if (process.platform !== "darwin") {
  try {
    process.title = "ax-code"
  } catch {}
}

// Claim the tab/window title before the child Node process even starts.
function terminalTitleDisabled() {
  const value = String(process.env.AX_CODE_DISABLE_TERMINAL_TITLE ?? "")
    .trim()
    .toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}
if (process.stdout.isTTY && !terminalTitleDisabled()) {
  try {
    process.stdout.write(axCodeJobTitleOsc())
  } catch {}
}

const nodeName = process.platform === "win32" ? "node.exe" : "node"
const ffiArgs = ["--experimental-ffi", "--disable-warning=ExperimentalWarning"]

function inspectNode(candidate) {
  const result = spawnSync(
    candidate,
    [
      ...ffiArgs,
      "-e",
      "require('node:ffi'); process.stdout.write([process.version, process.platform, process.arch].join('\\n'))",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    },
  )
  if (result.status !== 0) return
  const [version, platform, arch] = String(result.stdout).trim().split("\n")
  if (!version || !platform || !arch) return
  return { path: candidate, version, platform, arch }
}

function pathCandidates() {
  const common = process.platform === "darwin" ? ["/opt/homebrew/bin/node", "/usr/local/bin/node"] : []
  return [
    process.execPath,
    ...String(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.join(entry, nodeName)),
    ...common,
  ]
}

function uniqueExisting(candidates) {
  const seen = new Set()
  const out = []
  for (const candidate of candidates) {
    let real
    try {
      real = fs.realpathSync(candidate)
    } catch {
      continue
    }
    if (seen.has(real)) continue
    seen.add(real)
    out.push(candidate)
  }
  return out
}

function resolveFfiNode() {
  const explicit = process.env.AX_CODE_FFI_NODE
  if (explicit) {
    const runtime = inspectNode(explicit)
    if (!runtime) {
      throw new Error(`AX_CODE_FFI_NODE does not support node:ffi: ${explicit}`)
    }
    return runtime
  }

  const inspected = []
  for (const candidate of uniqueExisting(pathCandidates())) {
    const runtime = inspectNode(candidate)
    if (!runtime) {
      inspected.push(`${candidate} (no node:ffi support)`)
      continue
    }
    return runtime
  }

  throw new Error(
    [
      "AX Code TUI requires a Node runtime with node:ffi support.",
      "Install/use Node 26+, or set AX_CODE_FFI_NODE to a Node 26+ executable.",
      inspected.length ? `Inspected candidates:\n  - ${inspected.join("\n  - ")}` : "No Node candidates were found.",
    ].join("\n"),
  )
}

let runtime
try {
  runtime = resolveFfiNode()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const launchArgs = prepareNodeArgs(process.argv.slice(2))
const tuiArgs = [...ffiArgs, ...launchArgs]
const brandedPath = resolveBrandedNodePath(runtime.path)
const spawnOptions = brandedSpawnOptions(process.env)

// POSIX TUIs must remain the PTY's foreground process-group leader. Replace
// this selector process in place instead of leaving a Node parent between the
// terminal and the actual TUI. Windows has no process.execve implementation,
// so it retains the asynchronous child-process fallback below.
//
// Apple Terminal composes inactive-tab job titles from the full KERN_PROCARGS2
// argv, so the exec'd argv stays "AX-Code /dev/null [user args]": the Node
// flags and the entry move into NODE_OPTIONS (the entry loads via --import and
// /dev/null fills the main-script slot). The entry restores the caller's
// NODE_OPTIONS from AX_CODE_LAUNCH_NODE_OPTIONS before the CLI graph loads, so
// spawned Node children never re-import the whole CLI. Import values that are
// absolute paths become file URLs because NODE_OPTIONS tokenizes on spaces.
if (typeof process.execve === "function") {
  const { nodeFlags, entry, userArgs } = splitNodeLaunchArgs(launchArgs)
  const optionsFlags = []
  let solidLoader
  for (let i = 0; i < nodeFlags.length; i++) {
    const flag = nodeFlags[i]
    if (flag === "--import" && i + 1 < nodeFlags.length) {
      const value = nodeFlags[i + 1]
      if (value.includes("solid-loader")) solidLoader = value
      optionsFlags.push(flag, value.startsWith("/") ? pathToFileURL(value).href : value)
      i += 1
      continue
    }
    optionsFlags.push(flag)
  }
  const childEnv = { ...process.env, AX_CODE_LAUNCH_NODE_OPTIONS: process.env.NODE_OPTIONS ?? "" }
  const augmented = [...ffiArgs, ...optionsFlags]
  if (entry) augmented.push("--import", entry.startsWith("/") ? pathToFileURL(entry).href : entry)
  if (process.env.NODE_OPTIONS) augmented.push(process.env.NODE_OPTIONS)
  childEnv.NODE_OPTIONS = augmented.join(" ")
  if (solidLoader) childEnv.AX_CODE_CLI_SOLID_LOADER = solidLoader
  const childArgv = [AX_CODE_SPAWN_ARGV0, "/dev/null", ...userArgs]
  try {
    process.execve(brandedPath, childArgv, childEnv)
  } catch (error) {
    if (brandedPath === runtime.path) throw error
    process.execve(runtime.path, childArgv, childEnv)
  }
}

function runNode(candidate) {
  return new Promise((resolve) => {
    const child = spawn(candidate, tuiArgs, spawnOptions)
    child.once("error", (error) => resolve({ error }))
    child.once("exit", (status, signal) => resolve({ status, signal }))
  })
}

let result = await runNode(brandedPath)
if (result.error && brandedPath !== runtime.path) {
  result = await runNode(runtime.path)
}

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.signal) {
  process.kill(process.pid, result.signal)
}
process.exit(result.status ?? 1)
