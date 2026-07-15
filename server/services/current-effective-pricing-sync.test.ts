import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { CURRENT_EFFECTIVE_PRICING_SEED } from "./current-effective-pricing"
import { syncCurrentEffectivePricingSeed } from "./current-effective-pricing-sync"
import { openPricingDb, openPricingReadonlyDb } from "../storage/pricing-db"
import { pricing_record } from "../storage/schema.sql"
import { createPricingRecordDraft } from "./pricing-registry"

const now = 1_746_493_200

type PricingRow = {
  id: string
  canonical_model: string
  input_price: number
  output_price: number
  cache_read_price: number
  source_type: string
  source_url: string
  effective_time: number
  observed_time: number | null
  superseded_time: number | null
  enabled: number
}

function readPricingRows(pricingDbPath: string) {
  const db = openPricingReadonlyDb(pricingDbPath)
  try {
    return db.sqlite.prepare("select * from pricing_record order by id asc").all() as PricingRow[]
  } finally {
    db.sqlite.close()
  }
}

test("syncCurrentEffectivePricingSeed inserts the complete current seed into an empty durable registry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-pricing-sync-empty-"))
  const pricingDbPath = path.join(root, "pricing.db")

  const result = syncCurrentEffectivePricingSeed(pricingDbPath, now)
  const rows = readPricingRows(pricingDbPath)
  const activeRows = rows.filter((row) => row.enabled === 1 && row.superseded_time === null)

  assert.deepEqual(result, {
    inserted: CURRENT_EFFECTIVE_PRICING_SEED.length,
    updated: 0,
    unchanged: 0,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
  assert.equal(activeRows.length, CURRENT_EFFECTIVE_PRICING_SEED.length)
  assert.ok(activeRows.some((row) => row.id === "openai:gpt-5.6-terra"))
  assert.ok(activeRows.some((row) => row.id === "anthropic:claude-opus-4-8"))
})

test("syncCurrentEffectivePricingSeed archives stale codex-mini, promotes the official seed, and is idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-pricing-sync-stale-"))
  const pricingDbPath = path.join(root, "pricing.db")
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.insert(pricing_record).values(createPricingRecordDraft({
      id: "openai:gpt-5.1-codex-mini",
      canonicalVendor: "openai",
      canonicalModel: "gpt-5.1-codex-mini",
      vendorModelId: "gpt-5.1-codex-mini",
      currency: "USD",
      inputPrice: 0.25,
      outputPrice: 2,
      reasoningPrice: 2,
      cacheReadPrice: 0,
      cacheWritePrice: 0,
      sourceType: "openrouter",
      sourceUrl: "https://openrouter.ai/openai/gpt-5.1-codex-mini",
      confidence: "medium",
      isManualOverride: false,
      effectiveTime: now - 60,
      observedTime: now - 60,
      enabled: true,
    })).run()
  } finally {
    pricingDb.sqlite.close()
  }

  const first = syncCurrentEffectivePricingSeed(pricingDbPath, now)
  const rowsAfterFirst = readPricingRows(pricingDbPath)
  const activeCodexMini = rowsAfterFirst.find((row) => row.id === "openai:gpt-5.1-codex-mini")
  const archivedCodexRows = rowsAfterFirst.filter((row) => row.canonical_model === "gpt-5.1-codex-mini" && row.id !== "openai:gpt-5.1-codex-mini")

  assert.deepEqual(first, {
    inserted: CURRENT_EFFECTIVE_PRICING_SEED.length - 1,
    updated: 1,
    unchanged: 0,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
  assert.deepEqual(activeCodexMini && {
    source_type: activeCodexMini.source_type,
    source_url: activeCodexMini.source_url,
    cache_read_price: activeCodexMini.cache_read_price,
    enabled: activeCodexMini.enabled,
    superseded_time: activeCodexMini.superseded_time,
  }, {
    source_type: "official",
    source_url: "https://developers.openai.com/api/docs/models/gpt-5.1-codex-mini",
    cache_read_price: 0.025,
    enabled: 1,
    superseded_time: null,
  })
  assert.equal(archivedCodexRows.length, 1)
  assert.equal(archivedCodexRows[0].enabled, 0)
  assert.equal(archivedCodexRows[0].superseded_time, now)

  const second = syncCurrentEffectivePricingSeed(pricingDbPath, now + 3_600)
  const rowsAfterSecond = readPricingRows(pricingDbPath)

  assert.deepEqual(second, {
    inserted: 0,
    updated: 0,
    unchanged: CURRENT_EFFECTIVE_PRICING_SEED.length,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
  assert.equal(rowsAfterSecond.length, rowsAfterFirst.length)
  assert.equal(rowsAfterSecond.filter((row) => row.canonical_model === "gpt-5.1-codex-mini" && row.id !== "openai:gpt-5.1-codex-mini").length, 1)
  const unchangedCodexMini = rowsAfterSecond.find((row) => row.id === "openai:gpt-5.1-codex-mini")
  assert.equal(unchangedCodexMini?.effective_time, now)
  assert.equal(unchangedCodexMini?.observed_time, now)
})
