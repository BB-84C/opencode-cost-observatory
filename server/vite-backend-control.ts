import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"

const execFileAsync = promisify(execFile)
const CONTROL_PREFIX = "/__observatory/backend"
const ALLOWED_HOSTS = new Set(["127.0.0.1:41778", "localhost:41778", "[::1]:41778"])
const ALLOWED_ACTIONS = new Set(["status", "start", "restart"])

export type BackendControlAction = "status" | "start" | "stop"
export type BackendControlRunner = (action: BackendControlAction) => Promise<{ stdout: string; stderr: string }>

class BackendControlTimeoutError extends Error {
  constructor(action: BackendControlAction) {
    super(`backend control ${action} timed out`)
    this.name = "BackendControlTimeoutError"
  }
}

export function isAllowedLoopbackAddress(address: string | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"
}

export function isAllowedControlHost(host: string | string[] | undefined) {
  return typeof host === "string" && ALLOWED_HOSTS.has(host.toLowerCase())
}

export function isSameOrigin(origin: string | string[] | undefined, host: string | string[] | undefined) {
  if (origin == null) {
    return true
  }
  if (typeof origin !== "string" || !isAllowedControlHost(host)) {
    return false
  }

  try {
    const parsed = new URL(origin)
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === String(host).toLowerCase()
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader("content-type", "application/json")
  res.end(JSON.stringify(body))
}

function runWithTimeout(runner: BackendControlRunner, action: BackendControlAction, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    runner(action),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new BackendControlTimeoutError(action)), timeoutMs)
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout)
    }
  })
}

function defaultRunner(projectRoot: string, timeoutMs: number): BackendControlRunner {
  return async (action) => {
    const result = await execFileAsync("pwsh", ["-NoProfile", "-File", "bootstrap.ps1", action], {
      cwd: projectRoot,
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
    })
    return { stdout: result.stdout, stderr: result.stderr }
  }
}

function normalizeAction(url: string | undefined) {
  const pathname = new URL(url ?? "/", "http://127.0.0.1:41778").pathname
  if (!pathname.startsWith(`${CONTROL_PREFIX}/`)) {
    return null
  }
  const action = pathname.slice(`${CONTROL_PREFIX}/`.length)
  return ALLOWED_ACTIONS.has(action) ? action as "status" | "start" | "restart" : "unknown"
}

export function createBackendControlMiddleware(options: { projectRoot: string; runner?: BackendControlRunner; runnerTimeoutMs?: number }) {
  const runnerTimeoutMs = options.runnerTimeoutMs ?? 15000
  const runner = options.runner ?? defaultRunner(options.projectRoot, runnerTimeoutMs)

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const action = normalizeAction(req.url)
    if (action == null) {
      next()
      return
    }
    if (action === "unknown") {
      sendJson(res, 404, { ok: false, error: "not_found" })
      return
    }

    const host = req.headers.host
    if (!isAllowedLoopbackAddress(req.socket.remoteAddress) || !isAllowedControlHost(host)) {
      sendJson(res, 403, { ok: false, error: "forbidden" })
      return
    }

    if (action === "status" && req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" })
      return
    }
    if ((action === "start" || action === "restart") && req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" })
      return
    }

    if (req.method === "POST") {
      if (req.headers["x-observatory-control"] !== "1" || !isSameOrigin(req.headers.origin, host)) {
        sendJson(res, 403, { ok: false, error: "forbidden" })
        return
      }
    }

    void (async () => {
      try {
        if (action === "restart") {
          const stopped = await runWithTimeout(runner, "stop", runnerTimeoutMs)
          const started = await runWithTimeout(runner, "start", runnerTimeoutMs)
          sendJson(res, 200, {
            ok: true,
            action,
            stdout: [stopped.stdout, started.stdout].filter(Boolean).join("\n"),
            stderr: [stopped.stderr, started.stderr].filter(Boolean).join("\n"),
          })
          return
        }

        const result = await runWithTimeout(runner, action, runnerTimeoutMs)
        sendJson(res, 200, { ok: true, action, stdout: result.stdout, stderr: result.stderr })
      } catch (error) {
        if (error instanceof BackendControlTimeoutError) {
          sendJson(res, 504, { ok: false, error: "backend_control_timeout", detail: error.message })
          return
        }
        sendJson(res, 500, { ok: false, error: "backend_control_failed", detail: error instanceof Error ? error.message : String(error) })
      }
    })()
  }
}

export function observatoryBackendControlPlugin(projectRoot = path.resolve(".")): Plugin {
  return {
    name: "observatory-backend-control",
    configureServer(server) {
      server.middlewares.use(createBackendControlMiddleware({ projectRoot }))
    },
  }
}
