import type { NextFunction, Request, Response } from "express"

import type { PasskeyService } from "../services/passkey-service"

declare global {
  namespace Express {
    interface Request {
      user?: {
        username: string
        sessionExpiresAt: number
      }
    }
  }
}

function parseCookies(rawCookieHeader: string | undefined) {
  if (!rawCookieHeader) {
    return {}
  }
  return Object.fromEntries(rawCookieHeader.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=")
    if (index < 0) {
      return [part, ""]
    }
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))
}

export function getSessionToken(req: Request) {
  const authorization = req.header("authorization")
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]
  return bearer
    ?? req.header("x-bb84-session")
    ?? parseCookies(req.header("cookie"))["bb84_session"]
    ?? null
}

function wantsHtml(req: Request) {
  const accept = req.header("accept") ?? ""
  return accept.includes("text/html") && !accept.includes("application/json")
}

export function requireSession(service: PasskeyService, options: { adminName: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = service.getSession(getSessionToken(req))
    if (!session) {
      if (wantsHtml(req)) {
        res.redirect(302, "/login.html")
        return
      }
      res.status(401).json({ error: "unauthorized" })
      return
    }

    req.user = { username: options.adminName, sessionExpiresAt: session.expiresAt }
    next()
  }
}
