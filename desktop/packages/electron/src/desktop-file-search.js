"use strict"

const path = require("path")

const toNativeSearchRelativePath = (rootPath, filePath, pathTools = path) => {
  return pathTools
    .relative(rootPath, filePath)
    .split(pathTools.sep)
    .filter(Boolean)
    .join("/")
}

module.exports = {
  toNativeSearchRelativePath,
}
