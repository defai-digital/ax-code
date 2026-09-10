const { randomBytes } = require("node:crypto")
const path = require("node:path")

async function verifyPty(modulePath, { timeoutMs = 15_000 } = {}) {
  const pty = require(path.resolve(modulePath))
  const nonce = randomBytes(16).toString("hex")
  const expected = `AX_CODE_PTY_RESULT_${[...nonce].reverse().join("")}`
  // The expected response never appears in the input, so terminal echo cannot
  // satisfy the roundtrip. Exit only after stdout has flushed the response.
  const program = [
    "process.stdin.setEncoding('utf8'); let input = '';",
    "process.stdin.on('data', chunk => { input += chunk;",
    "if (!/[\\r\\n]/.test(input)) return;",
    "const line = input.split(/[\\r\\n]/)[0];",
    "process.stdout.write('AX_CODE_PTY_RESULT_' + [...line].reverse().join('') + '\\n', () => process.exit(0)); });",
    "process.stdout.write('AX_CODE_PTY_READY\\n');",
  ].join(" ")
  let child
  let timer
  let exited = false
  const subscriptions = []
  try {
    await new Promise((resolve, reject) => {
      let output = ""
      let sent = false
      const complete = () => {
        if (exited && output.includes(expected)) resolve()
      }
      timer = setTimeout(() => reject(new Error("PTY input/output/exit verification timed out")), timeoutMs)
      child = pty.spawn(process.execPath, ["-e", program], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: { ...process.env, TERM: "xterm-256color" },
        useConpty: process.platform === "win32",
      })
      subscriptions.push(
        child.onData((data) => {
          output += data
          if (output.length > 64 * 1024) {
            reject(new Error("PTY verification exceeded its output limit"))
            return
          }
          if (!sent && output.includes("AX_CODE_PTY_READY")) {
            sent = true
            try {
              child.resize(100, 30)
              child.write(nonce + (process.platform === "win32" ? "\r" : "\n"))
            } catch (error) {
              reject(error)
            }
          }
          complete()
        }),
        child.onExit(({ exitCode, signal }) => {
          exited = true
          if (exitCode !== 0 || (signal !== undefined && signal !== 0)) {
            reject(new Error(`PTY child exited unsuccessfully: code=${exitCode}, signal=${signal}`))
            return
          }
          complete()
        }),
      )
    })
    return { verified: true, platform: process.platform, arch: process.arch, node: process.version }
  } finally {
    clearTimeout(timer)
    for (const subscription of subscriptions) subscription.dispose()
    if (child && !exited) child.kill()
  }
}

module.exports = { verifyPty }

if (require.main === module) {
  const modulePath = process.argv[2]
  if (!modulePath) {
    console.error("Usage: node script/verify-pty.cjs <node-pty-package-directory>")
    process.exitCode = 1
  } else {
    verifyPty(modulePath).then(
      (result) => console.log(JSON.stringify(result)),
      (error) => {
        console.error(`PTY verification failed: ${error.message}`)
        process.exitCode = 1
      },
    )
  }
}
