import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { bootstrapAnalyticsDb } from "../storage/db"
import { ingestRoutes } from "./ingest"

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

async function withIngestServer(run: (baseUrl: string, analyticsDbPath: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-ingest-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  bootstrapAnalyticsDb(analyticsDbPath)

  const app = express()
  app.use(express.json({ limit: "10mb" }))
  app.use(ingestRoutes(analyticsDbPath, "secret-token"))
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

test("ingest rejects requests without a bearer token", async () => {
  await withIngestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [], sessions: [] }),
    })

    assert.equal(response.status, 401)
  })
})

test("ingest rejects requests with the wrong bearer token", async () => {
  await withIngestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      body: JSON.stringify({ messages: [], sessions: [] }),
    })

    assert.equal(response.status, 401)
  })
})

test("ingest accepts an empty batch", async () => {
  await withIngestServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
      body: JSON.stringify({ messages: [], sessions: [] }),
    })

    assert.equal(response.status, 200)
    assert.match(response.headers.get("x-ingest-server-time") ?? "", /^\d+$/)
    assert.deepEqual(await response.json(), {
      inserted: { messages: 0, sessions: 0 },
      skipped: { messages: 0 },
    })
  })
})

test("ingest atomically upserts valid session and immutable message batches", async () => {
  await withIngestServer(async (baseUrl, analyticsDbPath) => {
    const batch = {
      sessions: [{
        session_id: "session-1",
        parent_session_id: null,
        project_id: "project-1",
        directory: "D:/work/project",
        title: "Original title",
        time_created: 1_700_000_000_000,
      }],
      messages: [{
        message_id: "message-1",
        session_id: "session-1",
        project_id: "project-1",
        parent_message_id: null,
        provider_id: "openai",
        model_id: "gpt-test",
        time_created: 1_700_000_000_000,
        input_tokens: 10,
        output_tokens: 20,
        reasoning_tokens: 30,
        cache_read_tokens: 40,
        cache_write_tokens: 50,
        total_tokens: 150,
      }],
    }

    const first = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
      body: JSON.stringify(batch),
    })
    assert.equal(first.status, 200)
    assert.deepEqual(await first.json(), {
      inserted: { messages: 1, sessions: 1 },
      skipped: { messages: 0 },
    })

    const second = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
      body: JSON.stringify({
        sessions: [{ ...batch.sessions[0], title: "Updated title", directory: "D:/work/new", project_id: "project-2" }],
        messages: [{ ...batch.messages[0], total_tokens: 999 }],
      }),
    })
    assert.equal(second.status, 200)
    assert.deepEqual(await second.json(), {
      inserted: { messages: 0, sessions: 1 },
      skipped: { messages: 1 },
    })

    const sqlite = await import("better-sqlite3").then(({ default: Database }) => new Database(analyticsDbPath, { readonly: true }))
    try {
      const message = sqlite.prepare("select total_tokens from message_usage_fact where message_id = ?").get("message-1") as { total_tokens: number }
      assert.equal(message.total_tokens, 150)
      const session = sqlite.prepare("select title, directory, project_id from session_tree_edge where session_id = ?").get("session-1") as { title: string, directory: string, project_id: string }
      assert.deepEqual(session, { title: "Updated title", directory: "D:/work/new", project_id: "project-2" })
    } finally {
      sqlite.close()
    }
  })
})
