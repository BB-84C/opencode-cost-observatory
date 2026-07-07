import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { AppConfig } from "./config"
import { createServer } from "./main"

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

test("createServer mounts ingest-mode upload and dashboard read routes without local sync/auth routes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-main-ingest-"))
  await withServer(makeConfig("ingest", root), async (baseUrl) => {
    const overview = await fetch(`${baseUrl}/overview/lifetime`)
    assert.equal(overview.status, 200)

    const ingest = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers: { authorization: "Bearer ingest-token", "content-type": "application/json" },
      body: JSON.stringify({ messages: [], sessions: [] }),
    })
    assert.equal(ingest.status, 200)

    const sync = await fetch(`${baseUrl}/api/sync/status`)
    assert.equal(sync.status, 404)

    const auth = await fetch(`${baseUrl}/api/auth/session`)
    assert.equal(auth.status, 404)
  })
})
