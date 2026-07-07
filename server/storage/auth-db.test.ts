import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import Database from "better-sqlite3"

import { createAuthStore } from "./auth-db"

function dbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oco-auth-db-")), "auth.db")
}

test("auth store initializes credential, challenge, and session tables", () => {
  const authDbPath = dbPath()
  const store = createAuthStore(authDbPath, "k".repeat(32))
  store.close()

  const sqlite = new Database(authDbPath, { readonly: true })
  try {
    const tables = sqlite.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>
    assert.deepEqual(tables.map((row) => row.name), ["passkey_challenge", "passkey_credential", "session"])
  } finally {
    sqlite.close()
  }
})

test("auth store encrypts credential and challenge payload columns", () => {
  const authDbPath = dbPath()
  const store = createAuthStore(authDbPath, "k".repeat(32))
  try {
    store.upsertCredential({
      credentialId: "cred-1",
      credentialPublicKey: "secret-public-key",
      counter: 3,
      transports: ["internal"],
      name: "Laptop",
      createdAt: 100,
      lastUsedAt: null,
      lastIp: null,
    })
    store.saveChallenge("challenge-1", {
      type: "registration",
      challenge: "secret-challenge",
      expiresAt: Date.now() + 300_000,
      meta: { passkeyName: "Laptop" },
    })

    const sqlite = new Database(authDbPath, { readonly: true })
    try {
      const credential = sqlite.prepare("select credential_public_key, transports_json from passkey_credential where credential_id = ?").get("cred-1") as { credential_public_key: string, transports_json: string }
      assert.notEqual(credential.credential_public_key, "secret-public-key")
      assert.equal(/internal/.test(credential.transports_json), false)
      const challenge = sqlite.prepare("select challenge, meta_json from passkey_challenge where challenge_key = ?").get("challenge-1") as { challenge: string, meta_json: string }
      assert.notEqual(challenge.challenge, "secret-challenge")
      assert.equal(/Laptop/.test(challenge.meta_json), false)
    } finally {
      sqlite.close()
    }

    assert.equal(store.getCredential("cred-1")?.credentialPublicKey, "secret-public-key")
    assert.equal(store.consumeChallenge("challenge-1")?.challenge, "secret-challenge")
    assert.equal(store.consumeChallenge("challenge-1"), null)
  } finally {
    store.close()
  }
})

test("auth store creates, revokes, and cleans up sessions", () => {
  const store = createAuthStore(dbPath(), "k".repeat(32))
  try {
    store.createSession("token-1", { createdAt: 100, expiresAt: 200 })
    assert.equal(store.getSession("token-1")?.revoked, 0)

    store.revokeSession("token-1")
    assert.equal(store.getSession("token-1")?.revoked, 1)

    store.createSession("expired", { createdAt: 100, expiresAt: 101 })
    assert.equal(store.cleanupExpiredSessions(150), 1)
    assert.equal(store.getSession("expired"), null)
  } finally {
    store.close()
  }
})
