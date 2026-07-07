import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { bootstrapAnalyticsDb } from "../storage/db"
import { bootstrapPricingDb } from "../storage/pricing-db"
import { publicBadgeRoutes } from "./public-badge"

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

async function withBadgeServer(run: (baseUrl: string, analyticsDbPath: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-badge-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  bootstrapAnalyticsDb(analyticsDbPath)
  bootstrapPricingDb(pricingDbPath)

  const sqlite = await import("better-sqlite3").then(({ default: Database }) => new Database(analyticsDbPath))
  try {
    sqlite.prepare(`
      insert into message_usage_fact (message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("message-1", "session-1", "project-1", null, "openai", "gpt-test", 1_700_000_000_000, 100, 200, 300, 400, 0, 1_200)
  } finally {
    sqlite.close()
  }

  const app = express()
  app.use(publicBadgeRoutes(analyticsDbPath, pricingDbPath))
  const server = app.listen(0, "127.0.0.1")

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    assert.equal(typeof address, "object")
    assert.ok(address)
    const { port } = address as AddressInfo
    await run(`http://127.0.0.1:${port}`, analyticsDbPath)
  } finally {
    await closeServer(server)
  }
}

test("badge returns shields-compatible token JSON", async () => {
  await withBadgeServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/badge/tokens?label=total`)

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "public, max-age=300")
    assert.equal(response.headers.get("access-control-allow-origin"), "*")
    assert.deepEqual(await response.json(), {
      schemaVersion: 1,
      label: "total",
      message: "1.2K",
      color: "blue",
      cacheSeconds: 300,
    })
  })
})

test("badge caches lifetime token queries for the public cache window", async () => {
  await withBadgeServer(async (baseUrl, analyticsDbPath) => {
    const first = await fetch(`${baseUrl}/badge/tokens`)
    assert.equal((await first.json() as { message: string }).message, "1.2K")

    const sqlite = await import("better-sqlite3").then(({ default: Database }) => new Database(analyticsDbPath))
    try {
      sqlite.prepare(`
        insert into message_usage_fact (message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("message-2", "session-1", "project-1", null, "openai", "gpt-test", 1_700_000_001_000, 0, 0, 0, 0, 0, 9_999_999)
    } finally {
      sqlite.close()
    }

    const second = await fetch(`${baseUrl}/badge/tokens`)
    assert.equal((await second.json() as { message: string }).message, "1.2K")
  })
})
