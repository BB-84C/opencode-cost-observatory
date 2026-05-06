import assert from "node:assert/strict"
import test from "node:test"

import { DashboardApiError } from "./dashboard-api-error"
import { retryAnalyticsBusy } from "./dashboard-retry"

test("retryAnalyticsBusy retries retryable analytics busy failures with backoff", async () => {
  let attempts = 0
  const delays: number[] = []

  const result = await retryAnalyticsBusy(
    async () => {
      attempts += 1
      if (attempts < 3) {
        throw new DashboardApiError(503, "analytics_db_busy", true, { error: "analytics_db_busy", retryable: true })
      }
      return "loaded"
    },
    { delay: async (ms) => { delays.push(ms) } },
  )

  assert.equal(result, "loaded")
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [250, 500])
})

test("retryAnalyticsBusy does not retry non-retryable failures", async () => {
  let attempts = 0

  await assert.rejects(
    () => retryAnalyticsBusy(async () => {
      attempts += 1
      throw new DashboardApiError(500, "dashboard_failed", false, { error: "dashboard_failed" })
    }),
    /dashboard_request_failed:500:dashboard_failed/,
  )

  assert.equal(attempts, 1)
})
