import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { AppConfig } from "./config"
import { createServer } from "./main"
import { createPasskeyService } from "./services/passkey-service"

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function makeConfig(mode: "local" | "ingest", root: string): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    opencodeDbPath: path.join(root, "opencode.db"),
    analyticsDbPath: path.join(root, "analytics.db"),
    pricingDbPath: path.join(root, "pricing.db"),
    dashboardToken: "dashboard-token",
    bb84VpsMode: mode,
    ingestToken: mode === "ingest" ? "ingest-token" : undefined,
    bootstrapToken: mode === "ingest" ? "b".repeat(64) : undefined,
    webAuthnRpId: "tokenobs.bb84.ai",
    webAuthnRpName: "BB84 OpenCode Observatory",
    webAuthnOrigin: "https://tokenobs.bb84.ai",
    authSessionTtlSeconds: 604_800,
    authDbPath: path.join(root, "auth.db"),
    adminName: "admin",
    authEncryptionKey: mode === "ingest" ? "k".repeat(32) : undefined,
  }
}

async function withServer(config: AppConfig, run: (baseUrl: string) => Promise<void>) {
  const app = createServer(config)
  const server = app.listen(0, "127.0.0.1")

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    assert.equal(typeof address, "object")
    assert.ok(address)
    const { port } = address as AddressInfo
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await closeServer(server)
  }
}

test("createServer keeps dashboard routes token-gated in local mode and exposes public routes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-main-local-"))
  await withServer(makeConfig("local", root), async (baseUrl) => {
    const overview = await fetch(`${baseUrl}/overview/lifetime`)
    assert.equal(overview.status, 401)

    const badge = await fetch(`${baseUrl}/badge/tokens`)
    assert.equal(badge.status, 200)
  })
})

test("createServer mounts ingest-mode upload/public/auth routes and protects dashboard reads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-main-ingest-"))
  const config = makeConfig("ingest", root)
  await withServer(config, async (baseUrl) => {
    const overview = await fetch(`${baseUrl}/overview/lifetime`)
    assert.equal(overview.status, 401)

    const service = createPasskeyService({
      authDbPath: config.authDbPath,
      authEncryptionKey: config.authEncryptionKey!,
      bootstrapToken: config.bootstrapToken!,
      sessionTtlSeconds: config.authSessionTtlSeconds,
    })
    const session = service.createSession()
    service.close()

    const authedOverview = await fetch(`${baseUrl}/api/overview/lifetime`, { headers: { authorization: `Bearer ${session.token}` } })
    assert.equal(authedOverview.status, 200)

    const badge = await fetch(`${baseUrl}/api/badge/tokens`)
    assert.equal(badge.status, 200)

    const setup = await fetch(`${baseUrl}/auth/setup/status`)
    assert.equal(setup.status, 200)

    const ingest = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers: { authorization: "Bearer ingest-token", "content-type": "application/json" },
      body: JSON.stringify({ messages: [], sessions: [] }),
    })
    assert.equal(ingest.status, 200)

    const sync = await fetch(`${baseUrl}/api/sync/status`)
    assert.equal(sync.status, 401)

    const authedSync = await fetch(`${baseUrl}/api/sync/status`, { headers: { authorization: `Bearer ${session.token}` } })
    assert.equal(authedSync.status, 404)

    const auth = await fetch(`${baseUrl}/api/auth/session`)
    assert.equal(auth.status, 401)
  })
})
