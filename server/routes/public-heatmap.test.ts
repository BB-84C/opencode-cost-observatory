import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { bootstrapAnalyticsDb } from "../storage/db"
import { publicHeatmapRoutes } from "./public-heatmap"

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

async function withHeatmapServer(run: (baseUrl: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-heatmap-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  bootstrapAnalyticsDb(analyticsDbPath)

  const sqlite = await import("better-sqlite3").then(({ default: Database }) => new Database(analyticsDbPath))
  try {
    sqlite.prepare(`
      insert into message_usage_fact (message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("message-1", "session-1", "project-1", null, "openai", "gpt-test", Date.UTC(2026, 0, 5), 100, 200, 0, 0, 0, 300)
  } finally {
    sqlite.close()
  }

  const app = express()
  app.use(publicHeatmapRoutes(analyticsDbPath))
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

test("heatmap returns a github-style SVG token heatmap", async () => {
  await withHeatmapServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/heatmap/tokens.svg?theme=dark&days=90`)

    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type") ?? "", /^image\/svg\+xml/)
    assert.equal(response.headers.get("cache-control"), "public, max-age=300")
    const body = await response.text()
    assert.equal(body.startsWith("<svg"), true)
    assert.equal(body.endsWith("</svg>"), true)
    assert.match(body, /Less/)
    assert.match(body, /More/)
  })
})
