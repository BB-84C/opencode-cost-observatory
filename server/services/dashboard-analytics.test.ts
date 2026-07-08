import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import test from "node:test"

import { buildCostSessionLeaderboard, buildOverview, buildSeries, buildTokenSessionLeaderboard, readObservedPricingCoverage } from "./dashboard-analytics"
import { bootstrapAnalyticsDb, openAnalyticsDb } from "../storage/db"
import { openPricingDb } from "../storage/pricing-db"
import { message_usage_fact, sync_state } from "../storage/schema.sql"

function insertPricingRecord(pricingDbPath: string, now: number, model = "gpt-5.4") {
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `openai:${model}`,
      "openai",
      model,
      model,
      "USD",
      2.5,
      15,
      15,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0.25,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now - 60,
      now - 60,
      null,
      1,
    )
  } finally {
    pricingDb.sqlite.close()
  }
}

test("buildOverview prices wrapper-provider usage with the canonical official model row", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-overview-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = 1_746_493_200

  bootstrapAnalyticsDb(analyticsDbPath)
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  const pricingDb = openPricingDb(pricingDbPath)

  try {
    analyticsDb.insert(message_usage_fact).values({
      message_id: "m-1",
      session_id: "s-1",
      project_id: "p-1",
      parent_message_id: null,
      provider_id: "gauge-forge-openai",
      model_id: "gpt-5.4",
      time_created: now,
      input_tokens: 1_000_000,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 1_000_000,
    }).run()

    pricingDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:gpt-5.4",
      "openai",
      "gpt-5.4",
      "gpt-5.4",
      "USD",
      2.5,
      15,
      15,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0.25,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now - 60,
      now - 60,
      null,
      1,
    )
  } finally {
    analyticsDb.sqlite.close()
    pricingDb.sqlite.close()
  }

  const overview = buildOverview(analyticsDbPath, pricingDbPath, now)
  assert.equal(overview.priceCoverage, 1)
  assert.equal(overview.lifetimeSpendUsd, 2.5)
})

test("buildOverview prices vendor-scoped usage model ids with the canonical official model row", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-overview-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = 1_746_493_200

  bootstrapAnalyticsDb(analyticsDbPath)
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  const pricingDb = openPricingDb(pricingDbPath)

  try {
    analyticsDb.insert(message_usage_fact).values({
      message_id: "m-1",
      session_id: "s-1",
      project_id: "p-1",
      parent_message_id: null,
      provider_id: "gauge-forge-openai",
      model_id: "openai/gpt-5.4",
      time_created: now,
      input_tokens: 1_000_000,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 1_000_000,
    }).run()

    pricingDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:gpt-5.4",
      "openai",
      "gpt-5.4",
      "gpt-5.4",
      "USD",
      2.5,
      15,
      15,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0.25,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now - 60,
      now - 60,
      null,
      1,
    )
  } finally {
    analyticsDb.sqlite.close()
    pricingDb.sqlite.close()
  }

  const overview = buildOverview(analyticsDbPath, pricingDbPath, now)
  assert.equal(overview.priceCoverage, 1)
  assert.equal(overview.lifetimeSpendUsd, 2.5)
})

test("buildOverview coverage gaps ask for canonical model pricing instead of provider-scoped rows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-overview-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = 1_746_493_200

  bootstrapAnalyticsDb(analyticsDbPath)
  openPricingDb(pricingDbPath).sqlite.close()
  const analyticsDb = openAnalyticsDb(analyticsDbPath)

  try {
    analyticsDb.insert(message_usage_fact).values({
      message_id: "m-1",
      session_id: "s-1",
      project_id: "p-1",
      parent_message_id: null,
      provider_id: "gauge-forge-openai",
      model_id: "openai/gpt-5.4",
      time_created: now,
      input_tokens: 1_000_000,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 1_000_000,
    }).run()
  } finally {
    analyticsDb.sqlite.close()
  }

  const overview = buildOverview(analyticsDbPath, pricingDbPath, now)
  assert.equal(overview.pricingCoverageGaps.length, 1)
  assert.match(overview.pricingCoverageGaps[0].hint, /canonical model gpt-5\.4/)
  assert.doesNotMatch(overview.pricingCoverageGaps[0].hint, /vendor\/model exactly matches/)
})

test("buildOverview reads sync state without repairing interrupted refresh state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-overview-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = 1_746_493_200

  bootstrapAnalyticsDb(analyticsDbPath)
  openPricingDb(pricingDbPath).sqlite.close()
  const analyticsDb = openAnalyticsDb(analyticsDbPath)

  try {
    analyticsDb.insert(sync_state).values([
      { key: "sync_status", value: "requested" },
      { key: "sync_requested_at", value: String(now - 100) },
      { key: "sync_completed_at", value: "" },
      { key: "sync_failed_at", value: "" },
    ]).run()
  } finally {
    analyticsDb.sqlite.close()
  }

  buildOverview(analyticsDbPath, pricingDbPath, now)

  const verifyDb = openAnalyticsDb(analyticsDbPath)
  try {
    const rows = verifyDb.sqlite.prepare("select key, value from sync_state order by key asc").all() as Array<{ key: string; value: string }>
    const state = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    assert.equal(state.sync_status, "requested")
    assert.equal(state.sync_interrupted_at, undefined)
  } finally {
    verifyDb.sqlite.close()
  }
})

test("buildOverview aggregates large grouped usage without row-level pricing cost", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-overview-sql-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = 1_746_493_200
  const rowCount = 120_000

  bootstrapAnalyticsDb(analyticsDbPath)
  insertPricingRecord(pricingDbPath, now)
  const analyticsDb = openAnalyticsDb(analyticsDbPath)

  try {
    const insert = analyticsDb.sqlite.prepare(`
      insert into message_usage_fact (message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    analyticsDb.sqlite.exec("begin")
    try {
      for (let index = 0; index < rowCount; index += 1) {
        insert.run(`m-${index}`, `s-${index % 20}`, "p-1", null, "gauge-forge-openai", "gpt-5.4", now - (index % 86_400), 1_000, 0, 0, 0, 0, 1_000)
      }
      analyticsDb.sqlite.exec("commit")
    } catch (error) {
      analyticsDb.sqlite.exec("rollback")
      throw error
    }
  } finally {
    analyticsDb.sqlite.close()
  }

  const startedAt = performance.now()
  const overview = buildOverview(analyticsDbPath, pricingDbPath, now, "24h")
  const durationMs = performance.now() - startedAt

  assert.equal(overview.lifetimeTokens, rowCount * 1_000)
  assert.equal(overview.pricedTokens, rowCount * 1_000)
  assert.equal(overview.lifetimeSpendUsd, 300)
  assert.ok(durationMs < 500, `buildOverview took ${durationMs.toFixed(1)}ms`)
})

test("buildSeries and leaderboards preserve aggregate spend and token shapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-series-sql-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = Date.UTC(2026, 0, 3, 12, 0, 0) / 1000

  bootstrapAnalyticsDb(analyticsDbPath)
  insertPricingRecord(pricingDbPath, now)
  const analyticsDb = openAnalyticsDb(analyticsDbPath)

  try {
    analyticsDb.insert(message_usage_fact).values([
      { message_id: "m-1", session_id: "s-a", project_id: "p-1", parent_message_id: null, provider_id: "gauge-forge-openai", model_id: "gpt-5.4", time_created: Date.UTC(2026, 0, 2, 2, 0, 0), input_tokens: 1_000_000, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1_000_000 },
      { message_id: "m-2", session_id: "s-a", project_id: "p-1", parent_message_id: null, provider_id: "gauge-forge-openai", model_id: "gpt-5.4", time_created: Date.UTC(2026, 0, 2, 5, 0, 0), input_tokens: 2_000_000, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 2_000_000 },
      { message_id: "m-3", session_id: "s-b", project_id: "p-1", parent_message_id: null, provider_id: "gauge-forge-openai", model_id: "gpt-5.4", time_created: Date.UTC(2026, 0, 3, 5, 0, 0), input_tokens: 500_000, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 500_000 },
    ]).run()
  } finally {
    analyticsDb.sqlite.close()
  }

  const series = buildSeries(analyticsDbPath, pricingDbPath, { granularity: "daily", window: "7d", now })
  assert.deepEqual(series.points.map((point) => ({ date: point.date, inputTokens: point.inputTokens, totalCostUsd: point.totalCostUsd })), [
    { date: "2026-01-02", inputTokens: 3_000_000, totalCostUsd: 7.5 },
    { date: "2026-01-03", inputTokens: 500_000, totalCostUsd: 1.25 },
  ])

  const costLeaderboard = buildCostSessionLeaderboard(analyticsDbPath, pricingDbPath, 1)
  assert.equal(costLeaderboard.sessions[0].sessionId, "s-a")
  assert.equal(costLeaderboard.sessions[0].totalTokens, 3_000_000)
  assert.equal(costLeaderboard.sessions[0].totalCostUsd, 7.5)

  const tokenLeaderboard = buildTokenSessionLeaderboard(analyticsDbPath, pricingDbPath, 1)
  assert.equal(tokenLeaderboard.sessions[0].sessionId, "s-a")
})

test("readObservedPricingCoverage returns observed wrapper identity with canonical provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-observed-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const now = 1_746_493_200

  bootstrapAnalyticsDb(analyticsDbPath)
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  const pricingDb = openPricingDb(pricingDbPath)

  try {
    analyticsDb.insert(message_usage_fact).values({
      message_id: "m-1",
      session_id: "s-1",
      project_id: "p-1",
      parent_message_id: null,
      provider_id: "gauge-forge-openai",
      model_id: "gpt-5.5",
      time_created: now,
      input_tokens: 1_000,
      output_tokens: 2_000,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 3_000,
    }).run()

    pricingDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:gpt-5.5",
      "openai",
      "gpt-5.5",
      "gpt-5.5",
      "USD",
      5,
      30,
      30,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0.5,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now - 60,
      now - 60,
      null,
      1,
    )
  } finally {
    analyticsDb.sqlite.close()
    pricingDb.sqlite.close()
  }

  const rows = readObservedPricingCoverage(analyticsDbPath, pricingDbPath, now)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].observedProviderId, "gauge-forge-openai")
  assert.equal(rows[0].observedModelId, "gpt-5.5")
  assert.equal(rows[0].canonicalVendor, "openai")
  assert.equal(rows[0].sourceUrl, "https://developers.openai.com/api/docs/pricing")
  assert.equal(rows[0].resolutionStatus, "priced")
})
