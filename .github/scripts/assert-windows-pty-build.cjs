const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const build = path.resolve("packages/ax-code/node_modules/node-pty-prebuilt-multiarch/build")
// This is node-gyp's locally generated configuration, not external user input.
const config = JSON.parse(fs.readFileSync(path.join(build, "config.gypi"), "utf8").replace(/^#.*$/gm, ""))
assert.equal(config.variables.target_arch, process.arch)
assert.equal(String(config.variables.enable_lto), "false")
assert.equal(String(config.variables.enable_thin_lto), "false")
assert.equal(String(config.variables.lto_jobs), "0")
const projects = fs.readdirSync(build, { recursive: true }).filter((file) => file.endsWith(".vcxproj"))
assert.ok(projects.length > 0, "No generated MSVC projects")
for (const file of projects) {
  const source = fs.readFileSync(path.join(build, file), "utf8")
  assert.doesNotMatch(source, /-flto(?:=|\s|<)|\/opt:lldltojobs=/i, file)
}
console.log(JSON.stringify({ verified: true, arch: process.arch, projects: projects.length, lto: false }))
