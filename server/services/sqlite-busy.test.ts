import assert from "node:assert/strict"
import test from "node:test"

import { isSqliteBusyError, tryRespondWithAnalyticsBusy } from "./sqlite-busy"

test("isSqliteBusyError recognizes locked analytics errors", () => {
  assert.equal(isSqliteBusyError(new Error("SqliteError: database is locked")), true)
  assert.equal(isSqliteBusyError(new Error("SQLITE_BUSY: database is locked")), true)
  assert.equal(isSqliteBusyError(new Error("pricing_record_not_found")), false)
})

test("tryRespondWithAnalyticsBusy sends retryable 503 responses", () => {
  let statusCode: number | null = null
  let payload: unknown = null
  const response = {
    status(code: number) {
      statusCode = code
      return this
    },
    json(body: unknown) {
      payload = body
      return this
    },
  }

  assert.equal(tryRespondWithAnalyticsBusy(response, new Error("SQLITE_LOCKED: database table is locked")), true)
  assert.equal(statusCode, 503)
  assert.deepEqual(payload, {
    error: "analytics_db_busy",
    retryable: true,
    message: "Analytics store is temporarily busy during refresh",
  })
})
