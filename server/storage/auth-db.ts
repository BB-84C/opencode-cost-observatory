import crypto from "node:crypto"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { configure, ensureParentDir } from "./db-internals"

const ENCRYPTION_SALT = "bb84-observatory-passkey-auth"
const ENCRYPTION_VERSION = "v1"

export const passkey_credential = sqliteTable("passkey_credential", {
  credential_id: text().primaryKey(),
  credential_public_key: text().notNull(),
  counter: integer().notNull(),
  transports_json: text().notNull(),
  name: text().notNull(),
  created_at: integer().notNull(),
  last_used_at: integer(),
  last_ip: text(),
})

export const passkey_challenge = sqliteTable("passkey_challenge", {
  challenge_key: text().primaryKey(),
  type: text().notNull(),
  challenge: text().notNull(),
  expires_at: integer().notNull(),
  meta_json: text().notNull(),
})

export const session = sqliteTable("session", {
  token: text().primaryKey(),
  created_at: integer().notNull(),
  expires_at: integer().notNull(),
  revoked: integer().notNull(),
})

const authSchema = { passkey_credential, passkey_challenge, session }

export type StoredCredential = {
  credentialId: string
  credentialPublicKey: string
  counter: number
  transports: string[]
  name: string
  createdAt: number
  lastUsedAt: number | null
  lastIp: string | null
}

export type StoredChallenge = {
  type: "registration" | "authentication"
  challenge: string
  expiresAt?: number
  meta?: Record<string, unknown>
}

export type StoredSession = {
  token: string
  createdAt: number
  expiresAt: number
  revoked: 0 | 1
}

function keyFromSecret(secret: string) {
  return crypto.scryptSync(secret, ENCRYPTION_SALT, 32)
}

function encryptJson(value: unknown, key: Buffer) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()])
  return [ENCRYPTION_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":")
}

function decryptJson<T>(payload: string, key: Buffer): T {
  const [version, iv, tag, encrypted] = payload.split(":")
  if (version !== ENCRYPTION_VERSION || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted auth payload")
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()])
  return JSON.parse(decrypted.toString("utf8")) as T
}

export function createAuthStore(authDbPath: string, encryptionKey: string) {
  ensureParentDir(authDbPath)
  const sqlite = new Database(authDbPath)
  configure(sqlite, "readwrite")
  sqlite.exec(`
    create table if not exists passkey_credential (
      credential_id text primary key,
      credential_public_key text not null,
      counter integer not null,
      transports_json text not null,
      name text not null,
      created_at integer not null,
      last_used_at integer,
      last_ip text
    );

    create table if not exists passkey_challenge (
      challenge_key text primary key,
      type text not null,
      challenge text not null,
      expires_at integer not null,
      meta_json text not null
    );

    create table if not exists session (
      token text primary key,
      created_at integer not null,
      expires_at integer not null,
      revoked integer not null default 0
    );
  `)
  const key = keyFromSecret(encryptionKey)
  const db = drizzle(sqlite, { schema: authSchema })

  const upsertCredentialStatement = sqlite.prepare(`
    insert into passkey_credential (credential_id, credential_public_key, counter, transports_json, name, created_at, last_used_at, last_ip)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(credential_id) do update set
      credential_public_key = excluded.credential_public_key,
      counter = excluded.counter,
      transports_json = excluded.transports_json,
      name = excluded.name,
      last_used_at = excluded.last_used_at,
      last_ip = excluded.last_ip
  `)

  function decodeCredential(row: Record<string, unknown>): StoredCredential {
    return {
      credentialId: row.credential_id as string,
      credentialPublicKey: decryptJson<string>(row.credential_public_key as string, key),
      counter: Number(row.counter),
      transports: decryptJson<string[]>(row.transports_json as string, key),
      name: row.name as string,
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
      lastIp: row.last_ip == null ? null : row.last_ip as string,
    }
  }

  return Object.assign(db, {
    sqlite,
    close() {
      sqlite.close()
    },
    upsertCredential(credential: StoredCredential) {
      upsertCredentialStatement.run(
        credential.credentialId,
        encryptJson(credential.credentialPublicKey, key),
        credential.counter,
        encryptJson(credential.transports, key),
        credential.name,
        credential.createdAt,
        credential.lastUsedAt,
        credential.lastIp,
      )
    },
    getCredential(credentialId: string) {
      const row = sqlite.prepare("select * from passkey_credential where credential_id = ?").get(credentialId) as Record<string, unknown> | undefined
      return row ? decodeCredential(row) : null
    },
    listCredentials() {
      return (sqlite.prepare("select * from passkey_credential order by created_at asc, credential_id asc").all() as Array<Record<string, unknown>>).map(decodeCredential)
    },
    deleteCredential(credentialId: string) {
      sqlite.prepare("delete from passkey_credential where credential_id = ?").run(credentialId)
      return (sqlite.prepare("select count(*) as total from passkey_credential").get() as { total: number }).total
    },
    countCredentials() {
      return (sqlite.prepare("select count(*) as total from passkey_credential").get() as { total: number }).total
    },
    saveChallenge(challengeKey: string, challenge: Required<StoredChallenge>) {
      sqlite.prepare(`
        insert or replace into passkey_challenge (challenge_key, type, challenge, expires_at, meta_json)
        values (?, ?, ?, ?, ?)
      `).run(challengeKey, challenge.type, encryptJson(challenge.challenge, key), challenge.expiresAt, encryptJson(challenge.meta, key))
    },
    consumeChallenge(challengeKey: string, now = Date.now()) {
      let decoded: (Required<StoredChallenge> & { challengeKey: string }) | null = null
      sqlite.exec("begin immediate")
      try {
        const row = sqlite.prepare("select * from passkey_challenge where challenge_key = ?").get(challengeKey) as Record<string, unknown> | undefined
        if (row && Number(row.expires_at) > now) {
          decoded = {
            challengeKey,
            type: row.type as "registration" | "authentication",
            challenge: decryptJson<string>(row.challenge as string, key),
            expiresAt: Number(row.expires_at),
            meta: decryptJson<Record<string, unknown>>(row.meta_json as string, key),
          }
        }
        sqlite.prepare("delete from passkey_challenge where challenge_key = ?").run(challengeKey)
        sqlite.exec("commit")
      } catch (error) {
        sqlite.exec("rollback")
        throw error
      }
      return decoded
    },
    createSession(token: string, values: { createdAt: number, expiresAt: number }) {
      sqlite.prepare("insert into session (token, created_at, expires_at, revoked) values (?, ?, ?, 0)").run(token, values.createdAt, values.expiresAt)
    },
    getSession(token: string) {
      const row = sqlite.prepare("select token, created_at, expires_at, revoked from session where token = ?").get(token) as { token: string, created_at: number, expires_at: number, revoked: 0 | 1 } | undefined
      return row ? { token: row.token, createdAt: row.created_at, expiresAt: row.expires_at, revoked: row.revoked } : null
    },
    revokeSession(token: string) {
      sqlite.prepare("update session set revoked = 1 where token = ?").run(token)
    },
    cleanupExpiredSessions(now = Math.floor(Date.now() / 1000)) {
      return sqlite.prepare("delete from session where expires_at <= ?").run(now).changes
    },
  })
}
