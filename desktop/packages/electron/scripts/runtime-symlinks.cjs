"use strict"

const fs = require("node:fs")
const path = require("node:path")

const isWithin = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

const findUnsafeRuntimeSymlinks = (runtimeRoot, fileSystem = fs) => {
  const root = path.resolve(runtimeRoot)
  const realRoot = fileSystem.realpathSync(root)
  const unsafe = []

  const visit = (directory) => {
    for (const entry of fileSystem.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        try {
          if (!isWithin(realRoot, fileSystem.realpathSync(entryPath))) {
            unsafe.push(path.relative(root, entryPath))
          }
        } catch {
          unsafe.push(path.relative(root, entryPath))
        }
      } else if (entry.isDirectory()) {
        visit(entryPath)
      }
    }
  }

  visit(root)
  return unsafe.sort()
}

const removeUnsafeRuntimeSymlinks = (runtimeRoot, fileSystem = fs) => {
  const root = path.resolve(runtimeRoot)
  const unsafe = findUnsafeRuntimeSymlinks(root, fileSystem)
  for (const relativePath of unsafe) {
    fileSystem.unlinkSync(path.join(root, relativePath))
  }
  return unsafe
}

module.exports = {
  findUnsafeRuntimeSymlinks,
  removeUnsafeRuntimeSymlinks,
}
