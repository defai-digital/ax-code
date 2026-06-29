"use strict"

const path = require("path")

const toNativeSearchRelativePath = (rootPath, filePath, pathTools = path) => {
  return pathTools.relative(rootPath, filePath).split(pathTools.sep).filter(Boolean).join("/")
}

const shouldIncludeNativeSearchEntry = (entry, resultType, query) => {
  const normalizedType = resultType === "directory" ? "directory" : "file"
  const normalizedQuery = typeof query === "string" ? query.toLowerCase() : ""
  if (!entry || typeof entry.name !== "string") return false
  const matchesType =
    normalizedType === "directory"
      ? typeof entry.isDirectory === "function" && entry.isDirectory()
      : typeof entry.isFile === "function" && entry.isFile()
  return matchesType && entry.name.toLowerCase().includes(normalizedQuery)
}

module.exports = {
  shouldIncludeNativeSearchEntry,
  toNativeSearchRelativePath,
}
