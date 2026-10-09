import { pathToFileURL } from "node:url"

/** Match the Node.js 26+ support floor without depending on installed packages. */
export function supportsNodeVersion(version = process.versions.node) {
  const match = /^v?(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(version)
  return match !== null && Number.isSafeInteger(Number(match[1])) && Number(match[1]) >= 26
}

export function nodeSupportMessage(version = process.versions.node) {
  return `AX Code and its SDK require Node.js 26 or later; found ${version}. Install Node.js 26+ before continuing.`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && !supportsNodeVersion()) {
  console.error(nodeSupportMessage())
  process.exit(1)
}
