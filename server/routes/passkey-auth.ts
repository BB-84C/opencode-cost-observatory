import crypto from "node:crypto"

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import { Router, type Request, type Response } from "express"

import { getSessionToken } from "../middleware/passkey-session"
import type { PasskeyService } from "../services/passkey-service"

export type WebAuthnRuntime = {
  generateRegistrationOptions: (options: unknown) => Promise<unknown>
  verifyRegistrationResponse: (options: unknown) => Promise<unknown>
  generateAuthenticationOptions: (options: unknown) => Promise<unknown>
  verifyAuthenticationResponse: (options: unknown) => Promise<unknown>
}

type PasskeyRouteConfig = {
  adminName: string
  rpId: string
  rpName: string
  origin: string
  sessionTtlSeconds: number
}

type RateBucket = {
  count: number
  resetAt: number
}

const defaultWebAuthn: WebAuthnRuntime = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} as WebAuthnRuntime

const requestBuckets = new Map<string, RateBucket>()
const failureBuckets = new Map<string, RateBucket>()

function getClientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown"
}

function consumeBucket(buckets: Map<string, RateBucket>, key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }
  bucket.count += 1
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { ok: true, retryAfter: 0 }
}

function checkRateLimit(req: Request, res: Response) {
  const ip = getClientIp(req)
  const request = consumeBucket(requestBuckets, ip, 20, 60_000)
  const failure = failureBuckets.get(ip)
  const now = Date.now()
  if (!request.ok || (failure && failure.resetAt > now && failure.count >= 5)) {
    const retryAfter = request.ok ? Math.ceil(((failure?.resetAt ?? now + 900_000) - now) / 1000) : request.retryAfter
    res.setHeader("Retry-After", String(retryAfter))
    res.status(429).json({ error: "rate_limited", retryAfter })
    return false
  }
  return true
}

function recordFailure(req: Request) {
  consumeBucket(failureBuckets, getClientIp(req), 5, 900_000)
}

function resetFailure(req: Request) {
  failureBuckets.delete(getClientIp(req))
}

function validatePasskeyName(raw: unknown) {
  if (typeof raw !== "string") {
    return null
  }
  const name = raw.trim()
  return name.length >= 1 && name.length <= 64 ? name : null
}

function readBootstrapToken(req: Request) {
  const raw = req.body?.bootstrap_token ?? req.query.bootstrap_token ?? req.body?.token ?? req.query.token
  return typeof raw === "string" ? raw : null
}

function setSessionCookie(res: Response, token: string, ttlSeconds: number) {
  res.cookie("bb84_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds * 1000,
  })
}

function clearSessionCookie(res: Response) {
  res.cookie("bb84_session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

function createSessionResponse(service: PasskeyService, config: PasskeyRouteConfig, res: Response) {
  const session = service.createSession(config.sessionTtlSeconds)
  setSessionCookie(res, session.token, config.sessionTtlSeconds)
  return {
    session,
    body: {
      success: true,
      sessionToken: session.token,
      token: session.token,
      username: config.adminName,
      expiresAt: session.expiresAt,
      expiresIn: config.sessionTtlSeconds,
    },
  }
}

export function passkeyAuthRoutes(service: PasskeyService, config: PasskeyRouteConfig, webAuthn: WebAuthnRuntime = defaultWebAuthn) {
  const router = Router()

  router.get("/auth/setup/status", (_req, res) => {
    res.json({ hasPasskeys: service.hasCredentials() })
  })

  router.post("/auth/passkey/register/begin", async (req, res) => {
    try {
      if (!checkRateLimit(req, res)) return
      const passkeyName = validatePasskeyName(req.body?.passkeyName ?? req.body?.name)
      if (!passkeyName) {
        res.status(400).json({ error: "invalid_passkey_name" })
        return
      }

      const token = readBootstrapToken(req)
      const session = service.getSession(getSessionToken(req))
      const bootstrapOk = token ? service.isValidBootstrapToken(token) : false
      if (!bootstrapOk && !session) {
        recordFailure(req)
        res.status(401).json({ error: "unauthorized" })
        return
      }

      const existingCredentials = service.listCredentials()
      const registrationOptions = await webAuthn.generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpId,
        userID: Buffer.from(config.adminName, "utf8"),
        userName: config.adminName,
        userDisplayName: config.adminName,
        timeout: 60_000,
        attestationType: "none",
        excludeCredentials: existingCredentials.map((credential) => ({
          id: credential.credentialId,
          transports: credential.transports as never,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
        supportedAlgorithmIDs: [-7, -257],
      } as never)

      const challengeKey = crypto.randomBytes(16).toString("hex")
      service.saveChallenge(challengeKey, {
        type: "registration",
        challenge: (registrationOptions as { challenge: string }).challenge,
        meta: {
          passkeyName,
          mode: bootstrapOk ? "bootstrap" : "session",
          bootstrapToken: bootstrapOk ? token : undefined,
        },
      })
      res.json({ registrationOptions, challengeKey })
    } catch (error) {
      res.status(500).json({ error: "registration_begin_failed", message: error instanceof Error ? error.message : "unknown_error" })
    }
  })

  router.post("/auth/passkey/register/complete", async (req, res) => {
    try {
      const challenge = service.consumeChallenge(req.body?.challengeKey)
      if (!challenge || challenge.type !== "registration") {
        res.status(400).json({ error: "invalid_challenge" })
        return
      }

      const mode = challenge.meta?.mode
      if (mode === "bootstrap") {
        if (!service.isValidBootstrapToken(challenge.meta?.bootstrapToken)) {
          res.status(401).json({ error: "unauthorized" })
          return
        }
      } else if (!service.getSession(getSessionToken(req))) {
        res.status(401).json({ error: "unauthorized" })
        return
      }

      const verification = await webAuthn.verifyRegistrationResponse({
        response: req.body?.registrationResponse,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      } as never) as { verified: boolean, registrationInfo?: { credentialID: string | Uint8Array, credentialPublicKey: Uint8Array, counter: number } }

      if (!verification.verified || !verification.registrationInfo) {
        recordFailure(req)
        res.status(400).json({ error: "verification_failed" })
        return
      }

      const credentialId = typeof verification.registrationInfo.credentialID === "string"
        ? verification.registrationInfo.credentialID
        : Buffer.from(verification.registrationInfo.credentialID).toString("base64url")
      service.saveCredential({
        credentialId,
        credentialPublicKey: Buffer.from(verification.registrationInfo.credentialPublicKey).toString("base64url"),
        counter: verification.registrationInfo.counter,
        transports: Array.isArray(req.body?.registrationResponse?.response?.transports) ? req.body.registrationResponse.response.transports : [],
        name: String(challenge.meta?.passkeyName ?? "Passkey"),
        lastIp: getClientIp(req),
      })
      resetFailure(req)

      const { body } = createSessionResponse(service, config, res)
      res.json(body)
    } catch (error) {
      recordFailure(req)
      res.status(400).json({ error: "registration_complete_failed", message: error instanceof Error ? error.message : "unknown_error" })
    }
  })

  router.post("/auth/passkey/auth/begin", async (req, res) => {
    try {
      if (!checkRateLimit(req, res)) return
      const authOptions = await webAuthn.generateAuthenticationOptions({
        rpID: config.rpId,
        allowCredentials: undefined,
        timeout: 60_000,
        userVerification: "required",
      } as never)
      const challengeKey = crypto.randomBytes(16).toString("hex")
      service.saveChallenge(challengeKey, {
        type: "authentication",
        challenge: (authOptions as { challenge: string }).challenge,
        meta: {},
      })
      res.json({ authOptions, challengeKey })
    } catch (error) {
      res.status(500).json({ error: "authentication_begin_failed", message: error instanceof Error ? error.message : "unknown_error" })
    }
  })

  router.post("/auth/passkey/auth/complete", async (req, res) => {
    try {
      if (!checkRateLimit(req, res)) return
      const challenge = service.consumeChallenge(req.body?.challengeKey)
      if (!challenge || challenge.type !== "authentication") {
        recordFailure(req)
        res.status(400).json({ error: "invalid_challenge" })
        return
      }

      const credentialId = req.body?.authenticationResponse?.id
      const credential = typeof credentialId === "string" ? service.getCredential(credentialId) : null
      if (!credential) {
        recordFailure(req)
        res.status(401).json({ error: "unknown_credential" })
        return
      }

      const verification = await webAuthn.verifyAuthenticationResponse({
        response: req.body?.authenticationResponse,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        authenticator: {
          credentialID: credential.credentialId,
          credentialPublicKey: Buffer.from(credential.credentialPublicKey, "base64url"),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: true,
      } as never) as { verified: boolean, authenticationInfo?: { newCounter: number } }

      if (!verification.verified || !verification.authenticationInfo) {
        recordFailure(req)
        res.status(401).json({ error: "verification_failed" })
        return
      }

      service.updateCredentialUsage(credentialId, verification.authenticationInfo.newCounter, getClientIp(req))
      resetFailure(req)
      const { body } = createSessionResponse(service, config, res)
      res.json(body)
    } catch (error) {
      recordFailure(req)
      res.status(401).json({ error: "authentication_complete_failed", message: error instanceof Error ? error.message : "unknown_error" })
    }
  })

  router.post("/auth/logout", (req, res) => {
    service.revokeSession(getSessionToken(req))
    clearSessionCookie(res)
    res.json({ success: true })
  })

  router.get("/auth/session", (req, res) => {
    const session = service.getSession(getSessionToken(req))
    if (!session) {
      res.status(401).json({ error: "unauthorized" })
      return
    }
    res.json({ username: config.adminName, expiresAt: session.expiresAt })
  })

  return router
}
