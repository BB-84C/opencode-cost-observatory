import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { passkeyAuthRoutes, type WebAuthnRuntime } from "./passkey-auth"
import { createPasskeyService } from "../services/passkey-service"

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function fakeWebAuthn(): WebAuthnRuntime {
  return {
    generateRegistrationOptions: async () => ({ challenge: "reg-challenge", rp: { name: "BB84" }, user: { id: "admin", name: "admin", displayName: "admin" }, pubKeyCredParams: [] }),
    verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: { credentialID: "cred-1", credentialPublicKey: Buffer.from("public-key"), counter: 4 } }),
    generateAuthenticationOptions: async () => ({ challenge: "auth-challenge", allowCredentials: [] }),
    verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 5 } }),
  }
}

async function withAuthServer(run: (baseUrl: string, svc: ReturnType<typeof createPasskeyService>) => Promise<void>) {
  const authDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oco-passkey-routes-")), "auth.db")
  const svc = createPasskeyService({ authDbPath, authEncryptionKey: "k".repeat(32), bootstrapToken: "b".repeat(64), sessionTtlSeconds: 604_800 })
  const app = express()
  app.use(express.json())
  app.use(passkeyAuthRoutes(svc, {
    adminName: "admin",
    rpId: "tokenobs.bb84.ai",
    rpName: "BB84 OpenCode Observatory",
    origin: "https://tokenobs.bb84.ai",
    sessionTtlSeconds: 604_800,
  }, fakeWebAuthn()))
  const server = app.listen(0, "127.0.0.1")
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`, svc)
  } finally {
    svc.close()
    await closeServer(server)
  }
}

test("passkey auth reports setup status and rejects registration without bootstrap token or session", async () => {
  await withAuthServer(async (baseUrl) => {
    const status = await fetch(`${baseUrl}/auth/setup/status`)
    assert.deepEqual(await status.json(), { hasPasskeys: false })

    const begin = await fetch(`${baseUrl}/auth/passkey/register/begin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passkeyName: "Laptop" }) })
    assert.equal(begin.status, 401)
  })
})

test("passkey auth registers with bootstrap token and creates a secure session cookie", async () => {
  await withAuthServer(async (baseUrl, svc) => {
    const begin = await fetch(`${baseUrl}/auth/passkey/register/begin?bootstrap_token=${"b".repeat(64)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passkeyName: "Laptop" }) })
    assert.equal(begin.status, 200)
    const beginBody = await begin.json() as { challengeKey: string, registrationOptions: { challenge: string } }
    assert.equal(beginBody.registrationOptions.challenge, "reg-challenge")

    const complete = await fetch(`${baseUrl}/auth/passkey/register/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeKey: beginBody.challengeKey, registrationResponse: { response: { transports: ["internal"] } } }) })
    assert.equal(complete.status, 200)
    assert.match(complete.headers.get("set-cookie") ?? "", /bb84_session=.*HttpOnly; Secure; SameSite=Lax/)
    const body = await complete.json() as { sessionToken: string, username: string }
    assert.equal(body.username, "admin")
    assert.equal(svc.hasCredentials(), true)
    assert.equal(svc.getSession(body.sessionToken)?.revoked, 0)
  })
})

test("passkey auth authenticates an existing passkey and logout revokes the session", async () => {
  await withAuthServer(async (baseUrl, svc) => {
    svc.saveCredential({ credentialId: "cred-1", credentialPublicKey: Buffer.from("public-key").toString("base64url"), counter: 4, transports: ["internal"], name: "Laptop" })
    const begin = await fetch(`${baseUrl}/auth/passkey/auth/begin`, { method: "POST" })
    const beginBody = await begin.json() as { challengeKey: string, authOptions: { challenge: string } }
    assert.equal(beginBody.authOptions.challenge, "auth-challenge")

    const complete = await fetch(`${baseUrl}/auth/passkey/auth/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeKey: beginBody.challengeKey, authenticationResponse: { id: "cred-1" } }) })
    assert.equal(complete.status, 200)
    const body = await complete.json() as { sessionToken: string }
    assert.equal(svc.getCredential("cred-1")?.counter, 5)

    const session = await fetch(`${baseUrl}/auth/session`, { headers: { authorization: `Bearer ${body.sessionToken}` } })
    assert.equal(session.status, 200)
    assert.equal((await session.json() as { username: string }).username, "admin")

    const logout = await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${body.sessionToken}` } })
    assert.equal(logout.status, 200)
    assert.equal(svc.getSession(body.sessionToken), null)
  })
})
