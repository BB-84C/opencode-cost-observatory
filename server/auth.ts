import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Router, type NextFunction, type Request, type Response } from "express"

const DASHBOARD_TOKEN_HEADER = "x-dashboard-token"
const DASHBOARD_AUTH_COOKIE = "dashboard_auth"
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function parseCookies(rawCookieHeader: string | undefined) {
  if (!rawCookieHeader) {
    return {}
  }

  return Object.fromEntries(
    rawCookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        const separatorIndex = part.indexOf("=")
        if (separatorIndex < 0) {
          return [[part, ""]] as const
        }

        try {
          return [[part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))]] as const
        } catch {
          return []
        }
      }),
  )
}

export function getDashboardCredential(req: Request) {
  return req.header(DASHBOARD_TOKEN_HEADER)
    ?? parseCookies(req.header("cookie"))[DASHBOARD_AUTH_COOKIE]
    ?? null
}

export function isDashboardRequestAuthenticated(req: Request, token: string) {
  return getDashboardCredential(req) === token
}

function resolveLocalAuthFilePath(authFilePath: string) {
  return path.isAbsolute(authFilePath) ? authFilePath : path.resolve(projectRoot, authFilePath)
}

function readLocalAuthFileToken(authFilePath: unknown) {
  if (typeof authFilePath !== "string" || !authFilePath.trim()) {
    return null
  }

  try {
    const raw = fs.readFileSync(resolveLocalAuthFilePath(authFilePath.trim()), "utf8").trim()
    if (!raw) {
      return null
    }

    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { token?: unknown }
      return typeof parsed.token === "string" && parsed.token.trim() ? parsed.token : null
    }

    return raw
  } catch {
    return null
  }
}

function isLoopbackRequest(req: Request) {
  const remoteAddress = req.socket.remoteAddress?.trim().toLowerCase() ?? ""

  return remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress === "::ffff:127.0.0.1"
}

export function authRoutes(token: string, options: { localAuthFilePath?: string } = {}) {
  const router = Router()

  router.get("/auth/session", (req, res) => {
    res.json({ authenticated: isDashboardRequestAuthenticated(req, token) })
  })

  router.post("/auth/localhost-token", (req, res) => {
    if (!isLoopbackRequest(req)) {
      res.status(403).json({ error: "localhost_only" })
      return
    }

    const requestedToken = readLocalAuthFileToken(req.body?.authFilePath ?? options.localAuthFilePath)
      ?? (typeof req.body?.token === "string" ? req.body.token : null)

    if (requestedToken !== token) {
      res.status(401).json({ error: "unauthorized" })
      return
    }

    res.cookie(DASHBOARD_AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    })
    res.json({ authenticated: true })
  })

  return router
}

export function requireDashboardToken(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isDashboardRequestAuthenticated(req, token)) {
      res.status(401).json({ error: "unauthorized" })
      return
    }

    next()
  }
}
