import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { openAnalyticsDb } from "../server/storage/db"
import {
  UPLOADER_WATERMARK_KEY,
  isFatalIngestError,
  nextRetryDelayMs,
  readUploadBatch,
  readWatermark,
  uploadBatchOnce,
  writeWatermark,
} from "./main"

function newAnalyticsDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oco-uploader-")), "analytics.db")
}

function seedAnalyticsDb() {
  const analyticsDbPath = newAnalyticsDbPath()
  const db = openAnalyticsDb(analyticsDbPath)
  try {
    const insertSession = db.sqlite.prepare(`
      insert into session_tree_edge (session_id, parent_session_id, project_id, directory, title, time_created)
      values (?, ?, ?, ?, ?, ?)
    `)
    const insertMessage = db.sqlite.prepare(`
      insert into message_usage_fact (
        message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created,
        input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insertSession.run("s1", null, "p1", "D:/work/one", "One", 100)
    insertSession.run("s2", "s1", "p1", "D:/work/two", "Two", 102)
    insertSession.run("s3", null, "p2", "D:/work/three", "Three", 104)
    insertMessage.run("m1", "s1", "p1", null, "openai", "gpt-a", 101, 1, 2, 3, 4, 5, 15)
    insertMessage.run("m2", "s2", "p1", "m1", "anthropic", "claude-b", 102, 10, 20, 30, 40, 50, 150)
    insertMessage.run("m3", "s3", "p2", null, "openai", "gpt-c", 103, 100, 200, 300, 400, 500, 1500)
  } finally {
    db.sqlite.close()
  }

  return analyticsDbPath
}

test("readUploadBatch returns messages above watermark in ascending time order with associated sessions", () => {
  const analyticsDbPath = seedAnalyticsDb()

  const batch = readUploadBatch(analyticsDbPath, 100, 2)

  assert.deepEqual(batch.messages.map((row) => row.message_id), ["m1", "m2"])
  assert.deepEqual(batch.sessions.map((row) => row.session_id), ["s1", "s2"])
  assert.equal(batch.latestTimeCreated, 102)
})

test("readWatermark defaults to zero and writeWatermark stores the uploader sync_state key", () => {
  const analyticsDbPath = newAnalyticsDbPath()

  assert.equal(readWatermark(analyticsDbPath), 0)
  writeWatermark(analyticsDbPath, 12345)

  assert.equal(readWatermark(analyticsDbPath), 12345)

  const db = openAnalyticsDb(analyticsDbPath)
  try {
    const row = db.sqlite.prepare("select value from sync_state where key = ?").get(UPLOADER_WATERMARK_KEY) as { value: string }
    assert.equal(row.value, "12345")
  } finally {
    db.sqlite.close()
  }
})

test("uploadBatchOnce updates watermark only after ingest accepts the batch", async () => {
  const analyticsDbPath = seedAnalyticsDb()
  writeWatermark(analyticsDbPath, 100)

  const rejectedFetch = async () => new Response(JSON.stringify({ error: "temporarily_down" }), { status: 503 })
  await assert.rejects(
    uploadBatchOnce({
      analyticsDbPath,
      ingestUrl: "https://tokenobs.bb84.ai/api/ingest",
      ingestToken: "secret",
      batchSize: 2,
      fetchImpl: rejectedFetch,
      maxAttempts: 1,
      sleep: async () => {},
    }),
    /ingest_retry_exhausted/,
  )
  assert.equal(readWatermark(analyticsDbPath), 100)

  let postedBody: unknown
  const acceptedFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    postedBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ inserted: { messages: 2, sessions: 2 } }), { status: 200 })
  }

  const result = await uploadBatchOnce({
    analyticsDbPath,
    ingestUrl: "https://tokenobs.bb84.ai/api/ingest",
    ingestToken: "secret",
    batchSize: 2,
    fetchImpl: acceptedFetch,
    maxAttempts: 1,
    sleep: async () => {},
  })

  assert.equal(result.status, "uploaded")
  assert.equal(result.watermark, 102)
  assert.equal(readWatermark(analyticsDbPath), 102)
  assert.deepEqual((postedBody as { messages: Array<{ message_id: string }> }).messages.map((row) => row.message_id), ["m1", "m2"])
})

test("401 ingest responses are fatal and not retried", async () => {
  const analyticsDbPath = seedAnalyticsDb()
  let attempts = 0

  let error: unknown
  try {
    await uploadBatchOnce({
      analyticsDbPath,
      ingestUrl: "https://tokenobs.bb84.ai/api/ingest",
      ingestToken: "bad-secret",
      batchSize: 1,
      fetchImpl: async () => {
        attempts += 1
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
      },
      maxAttempts: 5,
      sleep: async () => {},
    })
  } catch (caught) {
    error = caught
  }

  assert.equal(isFatalIngestError(error), true)
  assert.equal(attempts, 1)
  assert.equal(readWatermark(analyticsDbPath), 0)
})

test("5xx ingest responses retry with capped exponential backoff", async () => {
  const analyticsDbPath = seedAnalyticsDb()
  const delays: number[] = []
  let attempts = 0

  const result = await uploadBatchOnce({
    analyticsDbPath,
    ingestUrl: "https://tokenobs.bb84.ai/api/ingest",
    ingestToken: "secret",
    batchSize: 1,
    fetchImpl: async () => {
      attempts += 1
      return attempts < 3
        ? new Response(JSON.stringify({ error: "busy" }), { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    maxAttempts: 3,
    sleep: async (ms) => { delays.push(ms) },
  })

  assert.equal(result.status, "uploaded")
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [1000, 2000])
  assert.equal(nextRetryDelayMs(10), 60000)
})
