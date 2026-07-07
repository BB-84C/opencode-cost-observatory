import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { requireSession } from "./passkey-session"
import { createPasskeyService } from "../services/passkey-service"

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function withMiddlewareServer(run: (baseUrl: string, token: string) => Promise<void>) {
  const authDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oco-passkey-mw-")), "auth.db")
  const svc = createPasskeyService({ authDbPath, authEncryptionKey: "k".repeat(32), bootstrapToken: "b".repeat(64), sessionTtlSeconds: 604_800 })
  const token = svc.createSession().token
  const app = express()
  app.use(requireSession(svc, { adminName: "overseer" }))
  app.get("/private", (req, res) => res.json({ user: req.user }))
  const server = app.listen(0, "127.0.0.1")
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`, token)
  } finally {
    svc.close()
    await closeServer(server)
  }
}

test("session middleware accepts bearer, cookie, and X-BB84-Session tokens", async () => {
  await withMiddlewareServer(async (baseUrl, token) => {
    assert.equal((await fetch(`${baseUrl}/private`, { headers: { authorization: `Bearer ${token}` } })).status, 200)
    assert.equal((await fetch(`${baseUrl}/private`, { headers: { cookie: `bb84_session=${token}` } })).status, 200)
    assert.equal((await fetch(`${baseUrl}/private`, { headers: { "x-bb84-session": token } })).status, 200)
  })
})

test("session middleware returns JSON 401 for API clients and redirects HTML clients", async () => {
  await withMiddlewareServer(async (baseUrl) => {
    const api = await fetch(`${baseUrl}/private`, { headers: { accept: "application/json" }, redirect: "manual" })
    assert.equal(api.status, 401)
    assert.deepEqual(await api.json(), { error: "unauthorized" })

    const html = await fetch(`${baseUrl}/private`, { headers: { accept: "text/html" }, redirect: "manual" })
    assert.equal(html.status, 302)
    assert.equal(html.headers.get("location"), "/login.html")
  })
})
