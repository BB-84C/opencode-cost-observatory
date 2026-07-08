import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { warmPrivateDashboardCache } from "./dashboard-cache-warmup"
import { dashboardPrivateResponseCache } from "../utils/response-cache"
import { bootstrapAnalyticsDb } from "../storage/db"
import { bootstrapPricingDb } from "../storage/pricing-db"

test("dashboard warm-up populates common private dashboard cache entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-warmup-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  bootstrapAnalyticsDb(analyticsDbPath)
  bootstrapPricingDb(pricingDbPath)
  dashboardPrivateResponseCache.clear()

  warmPrivateDashboardCache({ analyticsDbPath, pricingDbPath, now: 1_700_000_000 })

  assert.ok(dashboardPrivateResponseCache.get("overview:/api/overview/lifetime?window=30d"))
  assert.ok(dashboardPrivateResponseCache.get("series:/api/series/daily?metrics=cost%2CinputTokens%2CoutputTokens%2CreasoningTokens%2CcacheReadTokens%2CcacheWriteTokens&window=30d"))
  assert.ok(dashboardPrivateResponseCache.get("leaderboards:/api/leaderboards/cost-sessions?limit=5"))
})
