import crypto from "node:crypto"

import { createAuthStore, type StoredCredential } from "../storage/auth-db"

const CHALLENGE_TTL_MS = 300_000

export type PasskeyServiceOptions = {
  authDbPath: string
  authEncryptionKey: string
  bootstrapToken: string
  sessionTtlSeconds: number
}

export type ChallengeData = {
  type: "registration" | "authentication"
  challenge: string
  meta?: Record<string, unknown>
}

export type SessionData = {
  token: string
  createdAt: number
  expiresAt: number
}

function safeEqual(left: string, right: string) {
  const leftDigest = crypto.createHash("sha256").update(left).digest()
  const rightDigest = crypto.createHash("sha256").update(right).digest()
  return crypto.timingSafeEqual(leftDigest, rightDigest)
}

export function createPasskeyService(options: PasskeyServiceOptions) {
  const store = createAuthStore(options.authDbPath, options.authEncryptionKey)

  return {
    close() {
      store.close()
    },
    isValidBootstrapToken(token: unknown) {
      return typeof token === "string" && safeEqual(token, options.bootstrapToken)
    },
    saveCredential(input: Omit<StoredCredential, "createdAt" | "lastUsedAt" | "lastIp"> & Partial<Pick<StoredCredential, "createdAt" | "lastUsedAt" | "lastIp">>) {
      const now = Math.floor(Date.now() / 1000)
      const credential: StoredCredential = {
        credentialId: input.credentialId,
        credentialPublicKey: input.credentialPublicKey,
        counter: Number(input.counter || 0),
        transports: Array.isArray(input.transports) ? input.transports : [],
        name: input.name,
        createdAt: input.createdAt ?? now,
        lastUsedAt: input.lastUsedAt ?? null,
        lastIp: input.lastIp ?? null,
      }
      store.upsertCredential(credential)
      return credential
    },
    getCredential(credentialId: string) {
      return store.getCredential(credentialId)
    },
    listCredentials() {
      return store.listCredentials()
    },
    listPublicCredentials() {
      return store.listCredentials().map((credential) => ({
        credentialId: credential.credentialId,
        name: credential.name,
        transports: credential.transports,
        createdAt: credential.createdAt,
        lastUsedAt: credential.lastUsedAt,
        lastIp: credential.lastIp,
      }))
    },
    hasCredentials() {
      return store.countCredentials() > 0
    },
    deleteCredential(credentialId: string) {
      return store.deleteCredential(credentialId)
    },
    updateCredentialUsage(credentialId: string, counter: number, ip?: string | null) {
      const credential = store.getCredential(credentialId)
      if (!credential) {
        return null
      }
      credential.counter = Number(counter || credential.counter || 0)
      credential.lastUsedAt = Math.floor(Date.now() / 1000)
      credential.lastIp = ip ?? null
      store.upsertCredential(credential)
      return credential
    },
    saveChallenge(challengeKey: string, challenge: ChallengeData) {
      store.saveChallenge(challengeKey, {
        type: challenge.type,
        challenge: challenge.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
        meta: challenge.meta ?? {},
      })
    },
    consumeChallenge(challengeKey: string | undefined) {
      if (!challengeKey) {
        return null
      }
      return store.consumeChallenge(challengeKey)
    },
    createSession(ttlSeconds = options.sessionTtlSeconds): SessionData {
      const createdAt = Math.floor(Date.now() / 1000)
      const expiresAt = createdAt + ttlSeconds
      const token = crypto.randomBytes(32).toString("hex")
      store.createSession(token, { createdAt, expiresAt })
      return { token, createdAt, expiresAt }
    },
    getSession(token: string | null | undefined) {
      if (!token) {
        return null
      }
      const session = store.getSession(token)
      const now = Math.floor(Date.now() / 1000)
      if (!session || session.revoked || session.expiresAt <= now) {
        return null
      }
      return session
    },
    revokeSession(token: string | null | undefined) {
      if (token) {
        store.revokeSession(token)
      }
    },
    cleanupExpiredSessions() {
      return store.cleanupExpiredSessions()
    },
  }
}

export type PasskeyService = ReturnType<typeof createPasskeyService>
