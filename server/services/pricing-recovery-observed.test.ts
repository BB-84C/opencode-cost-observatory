import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { bootstrapAnalyticsDb } from "../storage/db"
import { openPricingDb, openPricingReadonlyDb } from "../storage/pricing-db"
import { pricing_record } from "../storage/schema.sql"
import { CURRENT_EFFECTIVE_PRICING_SEED } from "./current-effective-pricing"
import { normalizePricingModelKey } from "./pricing-identity"
import { createPricingRecordDraft } from "./pricing-registry"
import { ensurePricingRegistryReady } from "./pricing-recovery"

const now = 1_746_493_200

function insertOpenAiPricingRecord(pricingDbPath: string, input: {
  id: string
  canonicalModel: string
  vendorModel?: string
  inputPrice: number
  outputPrice: number
  enabled?: boolean
  supersededTime?: number | null
}) {
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.insert(pricing_record).values(createPricingRecordDraft({
      id: input.id,
      canonicalVendor: "openai",
      canonicalModel: input.canonicalModel,
      vendorModelId: input.vendorModel ?? input.canonicalModel,
      currency: "USD",
      inputPrice: input.inputPrice,
      outputPrice: input.outputPrice,
      reasoningPrice: input.outputPrice,
      cacheReadPrice: input.inputPrice / 10,
      cacheWritePrice: 0,
      sourceType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      confidence: "high",
      isManualOverride: false,
      effectiveTime: now - 60,
      observedTime: now - 60,
      supersededTime: input.supersededTime,
      enabled: input.enabled ?? true,
    })).run()
  } finally {
    pricingDb.sqlite.close()
  }
}

function pricingRowsById(pricingDbPath: string) {
  const db = openPricingReadonlyDb(pricingDbPath)
  try {
    return new Map((db.sqlite.prepare(`
      select id, canonical_model, vendor_model_id, enabled, superseded_time, input_price, output_price
      from pricing_record
      order by id asc
    `).all() as Array<{
      id: string
      canonical_model: string
      vendor_model_id: string
      enabled: number
      superseded_time: number | null
      input_price: number
      output_price: number
    }>).map((row) => [row.id, row]))
  } finally {
    db.sqlite.close()
  }
}

test("spark alias normalizes to Codex and is not seeded as a separate canonical row", () => {
  assert.equal(normalizePricingModelKey("gpt-5.3-codex-spark"), "gpt-5.3-codex")
  assert.equal(CURRENT_EFFECTIVE_PRICING_SEED.some((row) => row.id === "openai:gpt-5.3-codex-spark"), false)
  assert.equal(CURRENT_EFFECTIVE_PRICING_SEED.some((row) => row.canonicalModel === "gpt-5.3-codex-spark"), false)
})

test("ensurePricingRegistryReady tombstones active durable Spark canonical row when Codex pricing exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-observed-spark-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)
  insertOpenAiPricingRecord(pricingDbPath, {
    id: "openai:gpt-5.3-codex",
    canonicalModel: "gpt-5.3-codex",
    inputPrice: 1.75,
    outputPrice: 14,
  })
  insertOpenAiPricingRecord(pricingDbPath, {
    id: "openai:gpt-5.3-codex-spark",
    canonicalModel: "gpt-5.3-codex-spark",
    inputPrice: 0,
    outputPrice: 0,
  })

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = pricingRowsById(pricingDbPath)
  const codex = rows.get("openai:gpt-5.3-codex")
  const spark = rows.get("openai:gpt-5.3-codex-spark")

  assert.equal(result.source, "existing")
  assert.equal(result.inserted, 0)
  assert.equal(codex?.enabled, 1)
  assert.equal(codex?.superseded_time, null)
  assert.equal(codex?.input_price, 1.75)
  assert.equal(spark?.enabled, 0)
  assert.equal(spark?.superseded_time, now)
})

test("ensurePricingRegistryReady promotes a durable Spark-only registry to canonical Codex pricing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-observed-spark-only-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)
  insertOpenAiPricingRecord(pricingDbPath, {
    id: "openai:gpt-5.3-codex-spark",
    canonicalModel: "gpt-5.3-codex-spark",
    inputPrice: 0.5,
    outputPrice: 4,
  })

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = pricingRowsById(pricingDbPath)
  const codex = rows.get("openai:gpt-5.3-codex")
  const spark = rows.get("openai:gpt-5.3-codex-spark")

  assert.equal(result.source, "existing")
  assert.equal(result.inserted, 0)
  assert.equal(codex?.canonical_model, "gpt-5.3-codex")
  assert.equal(codex?.vendor_model_id, "gpt-5.3-codex")
  assert.equal(codex?.enabled, 1)
  assert.equal(codex?.superseded_time, null)
  assert.equal(codex?.input_price, 0.5)
  assert.equal(codex?.output_price, 4)
  assert.equal(spark?.enabled, 0)
  assert.equal(spark?.superseded_time, now)
})

test("ensurePricingRegistryReady tombstones Spark-like canonical rows with nonstandard ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-observed-spark-shadow-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)
  insertOpenAiPricingRecord(pricingDbPath, {
    id: "openai:legacy-spark-shadow",
    canonicalModel: "gpt-5.3-codex-spark",
    vendorModel: "gauge-forge-openai/gpt-5.3-codex-spark",
    inputPrice: 0.75,
    outputPrice: 6,
  })

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = pricingRowsById(pricingDbPath)
  const codex = rows.get("openai:gpt-5.3-codex")
  const sparkShadow = rows.get("openai:legacy-spark-shadow")

  assert.equal(result.source, "existing")
  assert.equal(result.inserted, 0)
  assert.equal(codex?.canonical_model, "gpt-5.3-codex")
  assert.equal(codex?.vendor_model_id, "gpt-5.3-codex")
  assert.equal(codex?.enabled, 1)
  assert.equal(codex?.input_price, 0.75)
  assert.equal(codex?.output_price, 6)
  assert.equal(sparkShadow?.enabled, 0)
  assert.equal(sparkShadow?.superseded_time, now)
})
