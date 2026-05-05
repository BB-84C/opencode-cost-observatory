const fs = require("node:fs")
const { spawn } = require("node:child_process")

function main() {
  const payloadPath = process.argv[2]
  if (!payloadPath) {
    throw new Error("missing_spawn_payload_path")
  }
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"))
  const stdout = fs.openSync(payload.stdoutLogPath, "a")
  const stderr = fs.openSync(payload.stderrLogPath, "a")
  const stdin = fs.openSync(payload.stdinPath, "r")
  const child = spawn(payload.nodeExecutable, payload.args, {
    cwd: payload.cwd,
    detached: true,
    windowsHide: true,
    stdio: [stdin, stdout, stderr],
    env: process.env,
  })

  child.unref()
  fs.writeFileSync(payload.pidPath, String(child.pid), "utf8")
  fs.closeSync(stdin)
  fs.closeSync(stdout)
  fs.closeSync(stderr)
  process.exit(0)
}

try {
  main()
} catch (error) {
  try {
    const payloadPath = process.argv[2]
    const payload = payloadPath ? JSON.parse(fs.readFileSync(payloadPath, "utf8")) : null
    if (payload?.errorPath) {
      fs.writeFileSync(payload.errorPath, error instanceof Error ? error.stack || error.message : String(error), "utf8")
    }
  } catch {
  }
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
}
