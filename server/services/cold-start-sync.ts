import fs from "node:fs"

import { openAnalyticsReadonlyDb } from "../storage/db"
import { hasActiveSyncRefresh, queueSyncRefresh } from "./dashboard-analytics"
import { RAW_OPENCODE_MESSAGES_CURSOR_KEY, RAW_OPENCODE_SESSIONS_CURSOR_KEY } from "./raw-opencode"

type CountRow = {
  total: number
}

type SyncStateRow = {
  key: string
  value: string
}

const priorSyncEvidenceKeys = new Set([
  "refresh_requested_at",
  "last_refresh_requested_at",
  "last_refresh_completed_at",
  "last_successful_sync_time",
  "last_sync_time",
  RAW_OPENCODE_MESSAGES_CURSOR_KEY,
  RAW_OPENCODE_SESSIONS_CURSOR_KEY,
  "sync_requested_at",
  "sync_started_at",
  "sync_completed_at",
])

const priorSyncStatusKeys = new Set([
  "last_refresh_status",
  "sync_status",
])

function tableCount(sqlite: ReturnType<typeof openAnalyticsReadonlyDb>["sqlite"], tableName: string) {
  const row = sqlite.prepare(`select count(*) as total from ${tableName}`).get() as CountRow
  return row.total
}

function hasPriorSyncEvidence(rows: SyncStateRow[]) {
  return rows.some((row) => {
    const value = row.value.trim()
    if (priorSyncEvidenceKeys.has(row.key)) {
      return value !== ""
    }

    return priorSyncStatusKeys.has(row.key) && value !== "" && value !== "idle"
  })
}

export function shouldQueueColdStartAnalyticsRefresh(analyticsDbPath: string, rawDbPath: string) {
  if (!fs.existsSync(rawDbPath)) {
    return false
  }

  if (hasActiveSyncRefresh(analyticsDbPath)) {
    return false
  }

  const db = openAnalyticsReadonlyDb(analyticsDbPath)
  try {
    if (tableCount(db.sqlite, "message_usage_fact") !== 0) {
      return false
    }

    if (tableCount(db.sqlite, "session_tree_edge") !== 0) {
      return false
    }

    const syncStateRows = db.sqlite.prepare(`
      select key, value
      from sync_state
    `).all() as SyncStateRow[]

    return !hasPriorSyncEvidence(syncStateRows)
  } finally {
    db.sqlite.close()
  }
}

export function queueColdStartAnalyticsRefresh(analyticsDbPath: string, rawDbPath: string) {
  if (!shouldQueueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath)) {
    return null
  }

  return queueSyncRefresh(analyticsDbPath, rawDbPath)
}
