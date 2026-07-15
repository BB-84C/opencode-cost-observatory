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
  reasoning_price: number
  reasoning_billing_rule_json: string
  cache_read_price: number
  cache_write_price: number
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
    supersededDuplicates: 0,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
  assert.equal(activeRows.length, CURRENT_EFFECTIVE_PRICING_SEED.length)
  assert.ok(activeRows.some((row) => row.id === "openai:gpt-5.6-terra"))
  assert.ok(activeRows.some((row) => row.id === "anthropic:claude-opus-4-8"))
  const models = new Map(activeRows.map((row) => [row.id, row]))
  for (const [id, expected] of Object.entries({
    "anthropic:claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, url: "https://claude.com/pricing" },
    "anthropic:claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, url: "https://claude.com/pricing" },
    "anthropic:claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, url: "https://claude.com/pricing" },
    "deepseek:deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0, url: "https://api-docs.deepseek.com/quick_start/pricing" },
    "deepseek:deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0, url: "https://api-docs.deepseek.com/quick_start/pricing" },
  })) {
    const row = models.get(id)
    assert.ok(row, `expected ${id} in current effective pricing seed`)
    assert.deepEqual(row && {
      input: row.input_price,
      output: row.output_price,
      reasoning: row.reasoning_price,
      cacheRead: row.cache_read_price,
      cacheWrite: row.cache_write_price,
      sourceType: row.source_type,
      url: row.source_url,
      reasoningBillingRule: JSON.parse(row.reasoning_billing_rule_json),
    }, {
      ...expected,
      reasoning: 0,
      sourceType: "official",
      reasoningBillingRule: {
        kind: "included_in_output",
        provenance: { sourceType: "official", sourceUrl: expected.url },
      },
    })
  }
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
    supersededDuplicates: 0,
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
    supersededDuplicates: 0,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
  assert.equal(rowsAfterSecond.length, rowsAfterFirst.length)
  assert.equal(rowsAfterSecond.filter((row) => row.canonical_model === "gpt-5.1-codex-mini" && row.id !== "openai:gpt-5.1-codex-mini").length, 1)
  const unchangedCodexMini = rowsAfterSecond.find((row) => row.id === "openai:gpt-5.1-codex-mini")
  assert.equal(unchangedCodexMini?.effective_time, now)
  assert.equal(unchangedCodexMini?.observed_time, now)
})

test("syncCurrentEffectivePricingSeed supersedes same-identity manual duplicates without touching non-seed records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-pricing-sync-duplicates-"))
  const pricingDbPath = path.join(root, "pricing.db")
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    for (const [id, canonicalModel] of [
      ["manual:anthropic:claude-opus-4-8", "claude-opus-4-8"],
      ["manual:anthropic:unknown", "claude-unknown"],
    ]) {
      pricingDb.insert(pricing_record).values(createPricingRecordDraft({
        id,
        canonicalVendor: "anthropic",
        canonicalModel,
        vendorModelId: canonicalModel,
        currency: "USD",
        inputPrice: 99,
        outputPrice: 99,
        reasoningPrice: 0,
        cacheReadPrice: 0,
        cacheWritePrice: 0,
        sourceType: "manual",
        sourceUrl: "https://pricing.example.test/manual",
        confidence: "medium",
        isManualOverride: true,
        effectiveTime: now - 60,
        observedTime: now - 60,
        enabled: true,
      })).run()
    }
  } finally {
    pricingDb.sqlite.close()
  }

  const first = syncCurrentEffectivePricingSeed(pricingDbPath, now)
  const rowsAfterFirst = readPricingRows(pricingDbPath)
  const duplicate = rowsAfterFirst.find((row) => row.id === "manual:anthropic:claude-opus-4-8")
  const unknown = rowsAfterFirst.find((row) => row.id === "manual:anthropic:unknown")

  assert.deepEqual(first, {
    inserted: CURRENT_EFFECTIVE_PRICING_SEED.length,
    updated: 0,
    unchanged: 0,
    supersededDuplicates: 1,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
  assert.deepEqual(duplicate && { enabled: duplicate.enabled, supersededTime: duplicate.superseded_time }, { enabled: 0, supersededTime: now })
  assert.deepEqual(unknown && { enabled: unknown.enabled, supersededTime: unknown.superseded_time }, { enabled: 1, supersededTime: null })
  assert.equal(rowsAfterFirst.filter((row) => row.id === "anthropic:claude-opus-4-8" && row.enabled === 1).length, 1)

  const second = syncCurrentEffectivePricingSeed(pricingDbPath, now + 3_600)
  assert.deepEqual(second, {
    inserted: 0,
    updated: 0,
    unchanged: CURRENT_EFFECTIVE_PRICING_SEED.length,
    supersededDuplicates: 0,
    total: CURRENT_EFFECTIVE_PRICING_SEED.length,
  })
})
