import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { z } from "zod"

import { syncRawOpencodeToAnalytics } from "../server/services/dashboard-analytics"
import { openAnalyticsDb } from "../server/storage/db"

export const UPLOADER_WATERMARK_KEY = "bb84_vps_uploader_watermark"
export const UPLOADER_LAST_SUCCESS_AT_KEY = "bb84_vps_uploader_last_success_at"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultEnvFilePath = path.join(projectRoot, ".env")

export type MessageUsageFactRow = {
  message_id: string
  session_id: string
  project_id: string
  parent_message_id: string | null
  provider_id: string
  model_id: string
  time_created: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
}

export type SessionTreeEdgeRow = {
  session_id: string
  parent_session_id: string | null
  project_id: string
  directory: string
  title: string
  time_created: number
}

export type UploadBatch = {
  messages: MessageUsageFactRow[]
  sessions: SessionTreeEdgeRow[]
  latestTimeCreated: number
}

type UploaderConfig = {
  ingestUrl: string
  ingestToken: string
  analyticsDbPath: string
  opencodeDbPath: string
  uploadIntervalMs: number
  uploadBatchSize: number
  uploadCatchupMaxRps: number
}

type FetchImpl = typeof fetch
type Sleep = (ms: number) => Promise<void>
type LogLevel = "debug" | "info" | "warn" | "error" | "fatal"
type LogFields = Record<string, unknown>
type Logger = (level: LogLevel, msg: string, fields?: LogFields) => void

const uploaderEnvSchema = z.object({
  INGEST_URL: z.string().trim().url(),
  INGEST_TOKEN: z.string().trim().min(1),
  OPENCODE_DB_PATH: z.string().trim().min(1).default(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")),
  ANALYTICS_DB_PATH: z.string().trim().min(1).default("./.run/analytics.db"),
  UPLOAD_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  UPLOAD_BATCH_SIZE: z.coerce.number().int().positive().default(5_000),
  UPLOAD_CATCHUP_MAX_RPS: z.coerce.number().positive().default(5),
})

class FatalIngestError extends Error {
  readonly fatal = true

  constructor(message: string) {
    super(message)
    this.name = "FatalIngestError"
  }
}

function resolveProjectPath(target: string) {
  return path.isAbsolute(target) ? target : path.resolve(projectRoot, target)
}

function readDotEnvFile(envFilePath = defaultEnvFilePath) {
  const parsed: Record<string, string> = {}
  if (!fs.existsSync(envFilePath)) {
    return parsed
  }

  for (const line of fs.readFileSync(envFilePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const commentIndex = rawValue.indexOf("#")
    const value = (commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue).trim()
    if (key) {
      parsed[key] = value
    }
  }

  return parsed
}

export function loadUploaderConfig(input: Record<string, string | undefined> = process.env, envFilePath = defaultEnvFilePath): UploaderConfig {
  const envFileConfig = readDotEnvFile(envFilePath)
  const parsed = uploaderEnvSchema.parse({
    INGEST_URL: input.INGEST_URL ?? envFileConfig.INGEST_URL,
    INGEST_TOKEN: input.INGEST_TOKEN ?? envFileConfig.INGEST_TOKEN,
    OPENCODE_DB_PATH: input.OPENCODE_DB_PATH ?? envFileConfig.OPENCODE_DB_PATH,
    ANALYTICS_DB_PATH: input.ANALYTICS_DB_PATH ?? envFileConfig.ANALYTICS_DB_PATH,
    UPLOAD_INTERVAL_MS: input.UPLOAD_INTERVAL_MS ?? envFileConfig.UPLOAD_INTERVAL_MS,
    UPLOAD_BATCH_SIZE: input.UPLOAD_BATCH_SIZE ?? envFileConfig.UPLOAD_BATCH_SIZE,
    UPLOAD_CATCHUP_MAX_RPS: input.UPLOAD_CATCHUP_MAX_RPS ?? envFileConfig.UPLOAD_CATCHUP_MAX_RPS,
  })

  return {
    ingestUrl: parsed.INGEST_URL,
    ingestToken: parsed.INGEST_TOKEN,
    opencodeDbPath: resolveProjectPath(parsed.OPENCODE_DB_PATH),
    analyticsDbPath: resolveProjectPath(parsed.ANALYTICS_DB_PATH),
    uploadIntervalMs: parsed.UPLOAD_INTERVAL_MS,
    uploadBatchSize: parsed.UPLOAD_BATCH_SIZE,
    uploadCatchupMaxRps: parsed.UPLOAD_CATCHUP_MAX_RPS,
  }
}

export function jsonLogger(level: LogLevel, msg: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...fields })
  if (level === "error" || level === "fatal" || level === "warn") {
    console.error(line)
    return
  }
  console.log(line)
}

export function readWatermark(analyticsDbPath: string) {
  const db = openAnalyticsDb(analyticsDbPath)
  try {
    const row = db.sqlite.prepare("select value from sync_state where key = ?").get(UPLOADER_WATERMARK_KEY) as { value: string } | undefined
    const parsed = Number(row?.value ?? 0)
    return Number.isFinite(parsed) ? parsed : 0
  } finally {
    db.sqlite.close()
  }
}

export function writeWatermark(analyticsDbPath: string, watermark: number) {
  const db = openAnalyticsDb(analyticsDbPath)
  try {
    db.sqlite.prepare(`
      insert into sync_state (key, value)
      values (?, ?)
      on conflict(key) do update set value = excluded.value
    `).run(UPLOADER_WATERMARK_KEY, String(watermark))
  } finally {
    db.sqlite.close()
  }
}

function writeSuccessfulUploadState(analyticsDbPath: string, watermark: number, now = Date.now()) {
  const db = openAnalyticsDb(analyticsDbPath)
  try {
    const statement = db.sqlite.prepare(`
      insert into sync_state (key, value)
      values (?, ?)
      on conflict(key) do update set value = excluded.value
    `)

    db.sqlite.exec("begin immediate")
    try {
      statement.run(UPLOADER_WATERMARK_KEY, String(watermark))
      statement.run(UPLOADER_LAST_SUCCESS_AT_KEY, String(now))
      db.sqlite.exec("commit")
    } catch (error) {
      db.sqlite.exec("rollback")
      throw error
    }
  } finally {
    db.sqlite.close()
  }
}

export function readUploadBatch(analyticsDbPath: string, watermark: number, batchSize: number): UploadBatch {
  const db = openAnalyticsDb(analyticsDbPath)
  try {
    const messages = db.sqlite.prepare(`
      select message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created,
             input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens
      from message_usage_fact
      where time_created > ?
      order by time_created asc, message_id asc
      limit ?
    `).all(watermark, batchSize) as MessageUsageFactRow[]

    if (messages.length === 0) {
      return { messages: [], sessions: [], latestTimeCreated: watermark }
    }

    const latestTimeCreated = messages.reduce((latest, row) => Math.max(latest, row.time_created), watermark)
    const sessionIds = [...new Set(messages.map((row) => row.session_id))]
    const placeholders = sessionIds.map(() => "?").join(", ")
    const sessions = db.sqlite.prepare(`
      select session_id, parent_session_id, project_id, directory, title, time_created
      from session_tree_edge
      where session_id in (${placeholders})
      order by time_created asc, session_id asc
    `).all(...sessionIds) as SessionTreeEdgeRow[]

    return { messages, sessions, latestTimeCreated }
  } finally {
    db.sqlite.close()
  }
}

export function nextRetryDelayMs(attempt: number) {
  return Math.min(60_000, 1000 * (2 ** Math.max(0, attempt)))
}

export function isFatalIngestError(error: unknown) {
  return error instanceof FatalIngestError
}

async function postIngestBatchWithRetry(options: {
  ingestUrl: string
  ingestToken: string
  batch: UploadBatch
  fetchImpl?: FetchImpl
  sleep?: Sleep
  maxAttempts?: number
  logger?: Logger
}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY
  let attempt = 0
  let lastError: unknown = null

  while (attempt < maxAttempts) {
    const startedAt = Date.now()
    try {
      const response = await fetchImpl(options.ingestUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.ingestToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages: options.batch.messages, sessions: options.batch.sessions }),
      })
      const elapsedMs = Date.now() - startedAt

      if (response.status === 401) {
        throw new FatalIngestError("ingest_unauthorized")
      }

      if (response.status >= 200 && response.status < 300) {
        options.logger?.("info", "ingest_batch_accepted", {
          statusCode: response.status,
          batchSize: options.batch.messages.length,
          watermark: options.batch.latestTimeCreated,
          elapsed_ms: elapsedMs,
        })
        return
      }

      const body = await response.text().catch(() => "")
      const error = new Error(`ingest_http_${response.status}${body ? `:${body.slice(0, 500)}` : ""}`)
      if (response.status >= 400 && response.status < 500) {
        throw new FatalIngestError(error.message)
      }
      lastError = error
    } catch (error) {
      if (isFatalIngestError(error)) {
        throw error
      }
      lastError = error
    }

    attempt += 1
    if (attempt >= maxAttempts) {
      break
    }

    const delayMs = nextRetryDelayMs(attempt - 1)
    options.logger?.("warn", "ingest_batch_retry", {
      attempt,
      delay_ms: delayMs,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    })
    await sleep(delayMs)
  }

  throw new Error(`ingest_retry_exhausted:${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export async function uploadBatchOnce(options: {
  analyticsDbPath: string
  ingestUrl: string
  ingestToken: string
  batchSize: number
  fetchImpl?: FetchImpl
  sleep?: Sleep
  maxAttempts?: number
  logger?: Logger
}) {
  const watermark = readWatermark(options.analyticsDbPath)
  const batch = readUploadBatch(options.analyticsDbPath, watermark, options.batchSize)
  if (batch.messages.length === 0) {
    return { status: "empty" as const, watermark, batchSize: 0 }
  }

  await postIngestBatchWithRetry({
    ingestUrl: options.ingestUrl,
    ingestToken: options.ingestToken,
    batch,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxAttempts: options.maxAttempts,
    logger: options.logger,
  })
  writeSuccessfulUploadState(options.analyticsDbPath, batch.latestTimeCreated)
  return { status: "uploaded" as const, watermark: batch.latestTimeCreated, batchSize: batch.messages.length }
}

export function runSyncWorkerOnce(opencodeDbPath: string, analyticsDbPath: string) {
  return syncRawOpencodeToAnalytics(opencodeDbPath, analyticsDbPath, Math.floor(Date.now() / 1000))
}

async function runUploaderDaemon(config: UploaderConfig, logger: Logger = jsonLogger) {
  let shutdownRequested = false
  const requestShutdown = () => {
    shutdownRequested = true
    logger("info", "shutdown_requested")
  }
  process.once("SIGINT", requestShutdown)
  process.once("SIGTERM", requestShutdown)

  const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  logger("info", "uploader_started", {
    ingestUrl: config.ingestUrl,
    analyticsDbPath: config.analyticsDbPath,
    opencodeDbPath: config.opencodeDbPath,
    uploadIntervalMs: config.uploadIntervalMs,
    uploadBatchSize: config.uploadBatchSize,
    uploadCatchupMaxRps: config.uploadCatchupMaxRps,
  })

  while (!shutdownRequested) {
    const loopStartedAt = Date.now()
    try {
      const syncResult = runSyncWorkerOnce(config.opencodeDbPath, config.analyticsDbPath)
      logger("info", "sync_worker_completed", { ...syncResult, elapsed_ms: Date.now() - loopStartedAt })

      let initialWatermark = readWatermark(config.analyticsDbPath)
      let batch = readUploadBatch(config.analyticsDbPath, initialWatermark, config.uploadBatchSize)
      const catchupMode = batch.messages.length >= config.uploadBatchSize
      const catchupDelayMs = Math.ceil(1000 / config.uploadCatchupMaxRps)

      while (batch.messages.length > 0) {
        const result = await uploadBatchOnce({
          analyticsDbPath: config.analyticsDbPath,
          ingestUrl: config.ingestUrl,
          ingestToken: config.ingestToken,
          batchSize: config.uploadBatchSize,
          sleep,
          logger,
        })
        logger("info", "upload_batch_completed", { batchSize: result.batchSize, watermark: result.watermark })
        if (shutdownRequested) {
          logger("info", "uploader_stopped_after_batch", { watermark: result.watermark })
          return
        }

        if (catchupMode && catchupDelayMs > 0) {
          await sleep(catchupDelayMs)
        }
        initialWatermark = readWatermark(config.analyticsDbPath)
        batch = readUploadBatch(config.analyticsDbPath, initialWatermark, config.uploadBatchSize)
      }
    } catch (error) {
      if (isFatalIngestError(error)) {
        logger("fatal", "uploader_fatal", { error: error instanceof Error ? error.message : String(error) })
        process.exitCode = 1
        return
      }
      logger("error", "uploader_loop_error", { error: error instanceof Error ? error.stack ?? error.message : String(error) })
    }

    if (!shutdownRequested) {
      await sleep(config.uploadIntervalMs)
    }
  }
}

function isDirectExecution() {
  const entry = process.argv[1]
  return !!entry && path.resolve(entry) === fileURLToPath(import.meta.url)
}

if (isDirectExecution()) {
  process.on("uncaughtException", (error) => {
    jsonLogger("fatal", "uncaught_exception", { error: error.stack ?? error.message })
    process.exit(1)
  })
  process.on("unhandledRejection", (reason) => {
    jsonLogger("fatal", "unhandled_rejection", { error: reason instanceof Error ? reason.stack ?? reason.message : String(reason) })
    process.exit(1)
  })

  try {
    await runUploaderDaemon(loadUploaderConfig())
  } catch (error) {
    jsonLogger("fatal", "uploader_start_failed", { error: error instanceof Error ? error.stack ?? error.message : String(error) })
    process.exit(1)
  }
}
