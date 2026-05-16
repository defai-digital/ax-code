#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function findBinary() {
  const helperPath = [
    path.join(__dirname, "bin", "binary-selection.cjs"),
    path.join(__dirname, "..", "bin", "binary-selection.cjs"),
  ].find((candidate) => fs.existsSync(candidate))
  if (!helperPath) throw new Error("Could not find binary-selection.cjs")

  const { candidatePackageNames, findBinary: findInstalledBinary } = require(helperPath)
  const selection = candidatePackageNames()
  const binaryPath = findInstalledBinary(__dirname)
  if (!binaryPath) {
    if (selection.unsupported) throw new Error(selection.unsupported)
    throw new Error(`Could not find a supported binary package. Tried ${selection.names.join(", ")}`)
  }

  return { binaryPath, binaryName: selection.binary }
}

async function main() {
  try {
    if (os.platform() === "win32") {
      // On Windows, the .exe is already included in the package and bin field points to it
      // No postinstall setup needed
      console.log("Windows detected: binary setup not needed (using packaged .exe)")
      return
    }

    // On non-Windows platforms, just verify the binary package exists
    // Don't replace the wrapper script - it handles binary execution
    const { binaryPath } = findBinary()
    const target = path.join(__dirname, "bin", ".ax-code")
    if (fs.existsSync(target)) fs.unlinkSync(target)
    try {
      fs.linkSync(binaryPath, target)
    } catch {
      fs.copyFileSync(binaryPath, target)
    }
    fs.chmodSync(target, 0o755)
  } catch (error) {
    console.error("Failed to setup ax-code binary:", error.message)
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error("Postinstall script error:", error.message)
  process.exit(0)
}
