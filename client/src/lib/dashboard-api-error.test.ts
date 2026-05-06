import assert from "node:assert/strict"
import test from "node:test"

import { DashboardApiError, isRetryableAnalyticsBusyError } from "./dashboard-api-error"

test("isRetryableAnalyticsBusyError returns true only for retryable analytics busy responses", () => {
  const busy = new DashboardApiError(503, "analytics_db_busy", true, { error: "analytics_db_busy", retryable: true })
  const missing = new DashboardApiError(404, "pricing_record_not_found", false, { error: "pricing_record_not_found" })

  assert.equal(isRetryableAnalyticsBusyError(busy), true)
  assert.equal(isRetryableAnalyticsBusyError(missing), false)
})

test("DashboardApiError keeps status, code, retryability, and payload", () => {
  const payload = { error: "analytics_db_busy", retryable: true }
  const error = new DashboardApiError(503, "analytics_db_busy", true, payload)

  assert.equal(error.message, "dashboard_request_failed:503:analytics_db_busy")
  assert.equal(error.status, 503)
  assert.equal(error.code, "analytics_db_busy")
  assert.equal(error.retryable, true)
  assert.equal(error.payload, payload)
})
