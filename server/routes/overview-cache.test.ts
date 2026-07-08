import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import Database from "better-sqlite3"
import express from "express"

import { bootstrapAnalyticsDb } from "../storage/db"
import { bootstrapPricingDb } from "../storage/pricing-db"
import { overviewRoutes } from "./overview"

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function withOverviewServer(cachePrivateResponses: boolean, run: (baseUrl: string, analyticsDbPath: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-overview-cache-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  bootstrapAnalyticsDb(analyticsDbPath)
  bootstrapPricingDb(pricingDbPath)

  const app = express()
  app.use(overviewRoutes(analyticsDbPath, pricingDbPath, { cachePrivateResponses }))
  const server = app.listen(0, "127.0.0.1")
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`, analyticsDbPath)
  } finally {
    await closeServer(server)
  }
}

function insertUsage(analyticsDbPath: string, messageId: string, totalTokens: number) {
  const sqlite = new Database(analyticsDbPath)
  try {
    sqlite.prepare(`
      insert into message_usage_fact (message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, "session-1", "project-1", null, "openai", "gpt-test", Date.now(), 0, 0, 0, 0, 0, totalTokens)
  } finally {
    sqlite.close()
  }
}

test("overview route caches JSON responses when ingest cache is enabled", async () => {
  await withOverviewServer(true, async (baseUrl, analyticsDbPath) => {
    insertUsage(analyticsDbPath, "message-1", 100)
    const first = await fetch(`${baseUrl}/overview/lifetime`)
    assert.equal((await first.json() as { lifetimeTokens: number }).lifetimeTokens, 100)

    insertUsage(analyticsDbPath, "message-2", 900)
    const second = await fetch(`${baseUrl}/overview/lifetime`)
    assert.equal(second.headers.get("content-length"), first.headers.get("content-length"))
    assert.equal((await second.json() as { lifetimeTokens: number }).lifetimeTokens, 100)
  })
})

test("overview route stays uncached when ingest cache is disabled", async () => {
  await withOverviewServer(false, async (baseUrl, analyticsDbPath) => {
    insertUsage(analyticsDbPath, "message-1", 100)
    assert.equal((await (await fetch(`${baseUrl}/overview/lifetime`)).json() as { lifetimeTokens: number }).lifetimeTokens, 100)

    insertUsage(analyticsDbPath, "message-2", 900)
    assert.equal((await (await fetch(`${baseUrl}/overview/lifetime`)).json() as { lifetimeTokens: number }).lifetimeTokens, 1_000)
  })
})
