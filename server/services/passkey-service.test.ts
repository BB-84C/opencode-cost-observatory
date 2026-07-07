import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createPasskeyService } from "./passkey-service"

function service() {
  const authDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oco-passkey-service-")), "auth.db")
  return createPasskeyService({
    authDbPath,
    authEncryptionKey: "k".repeat(32),
    bootstrapToken: "b".repeat(64),
    sessionTtlSeconds: 604_800,
  })
}

test("passkey service stores and lists public credentials", () => {
  const svc = service()
  try {
    assert.equal(svc.hasCredentials(), false)
    svc.saveCredential({ credentialId: "cred-1", credentialPublicKey: "public-key", counter: 0, transports: ["usb"], name: "YubiKey" })
    assert.equal(svc.hasCredentials(), true)
    assert.equal(svc.getCredential("cred-1")?.credentialPublicKey, "public-key")
    assert.deepEqual(svc.listPublicCredentials(), [{ credentialId: "cred-1", name: "YubiKey", transports: ["usb"], createdAt: svc.getCredential("cred-1")?.createdAt, lastUsedAt: null, lastIp: null }])
    assert.equal(svc.deleteCredential("cred-1"), 0)
  } finally {
    svc.close()
  }
})

test("passkey service consumes challenges exactly once", () => {
  const svc = service()
  try {
    svc.saveChallenge("key-1", { type: "authentication", challenge: "challenge", meta: {} })
    assert.equal(svc.consumeChallenge("key-1")?.challenge, "challenge")
    assert.equal(svc.consumeChallenge("key-1"), null)
  } finally {
    svc.close()
  }
})

test("passkey service validates bootstrap token and sessions", () => {
  const svc = service()
  try {
    assert.equal(svc.isValidBootstrapToken("wrong"), false)
    assert.equal(svc.isValidBootstrapToken("b".repeat(64)), true)
    const session = svc.createSession(10)
    assert.equal(session.token.length, 64)
    assert.equal(svc.getSession(session.token)?.revoked, 0)
    svc.revokeSession(session.token)
    assert.equal(svc.getSession(session.token), null)
  } finally {
    svc.close()
  }
})
