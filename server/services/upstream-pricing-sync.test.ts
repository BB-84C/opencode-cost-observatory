import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { syncUpstreamPricing, normalizeUpstreamIdentity, UPSTREAM_PRICING_URL } from "./upstream-pricing-sync"
import { openPricingDb } from "../storage/pricing-db"
import { pricing_record } from "../storage/schema.sql"
import { createPricingRecordDraft } from "./pricing-registry"

const now = 1_746_493_200

type PricingRow = {
  id: string
  canonical_vendor: string
  canonical_model: string
  vendor_model_id: string
  input_price: number
  output_price: number
  cache_read_price: number
  cache_write_price: number
  source_type: string
  source_url: string
  enabled: number
  superseded_time: number | null
}

function readRows(pricingDbPath: string) {
  const db = openPricingDb(pricingDbPath)
  try {
    return db.sqlite.prepare("select * from pricing_record order by id asc").all() as PricingRow[]
  } finally {
    db.sqlite.close()
  }
}

function insertOfficialRow(pricingDbPath: string, id: string, canonicalVendor: string, canonicalModel: string) {
  const db = openPricingDb(pricingDbPath)
  try {
    db.insert(pricing_record).values(createPricingRecordDraft({
      id,
      canonicalVendor,
      canonicalModel,
      vendorModelId: canonicalModel,
      currency: "USD",
      inputPrice: 1,
      outputPrice: 2,
      reasoningPrice: 0,
      cacheReadPrice: 0,
      cacheWritePrice: 0,
      sourceType: "official",
      sourceUrl: "https://claude.com/pricing",
      confidence: "high",
      isManualOverride: false,
      effectiveTime: now - 60,
      observedTime: now - 60,
      enabled: true,
    })).run()
  } finally {
    db.sqlite.close()
  }
}

function fakeFetch(catalog: unknown[]) {
  return async () => new Response(JSON.stringify({ data: catalog }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }) as Response
}

function makePricingDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-upstream-sync-"))
  return path.join(root, "pricing.db")
}

test("normalizeUpstreamIdentity maps vendor/model to vendor:model and strips date suffixes only for known identities", () => {
  const known = new Set(["deepseek:deepseek-v4-flash", "deepseek:deepseek-v4-pro"])
  assert.equal(normalizeUpstreamIdentity("openai/gpt-6-astra", known), "openai:gpt-6-astra")
  assert.equal(normalizeUpstreamIdentity("deepseek/deepseek-v4-flash-0731", known), "deepseek:deepseek-v4-flash")
  assert.equal(normalizeUpstreamIdentity("deepseek/deepseek-v4-pro-0813", known), "deepseek:deepseek-v4-pro")
  assert.equal(normalizeUpstreamIdentity("vendor/unknown-model-1234", known), "vendor:unknown-model-1234")
})

test("syncUpstreamPricing maps prices, resolves aliases, skips batch/free/unpriced entries, and keeps free models", async () => {
  const pricingDbPath = makePricingDb()
  insertOfficialRow(pricingDbPath, "deepseek:deepseek-v4-flash", "deepseek", "deepseek-v4-flash")
  insertOfficialRow(pricingDbPath, "manual:deepseek:deepseek-v4-flash", "deepseek", "deepseek-v4-flash")

  const catalog = [
    { id: "openai/gpt-6-astra", pricing: { prompt: "0.00001", completion: "0.00005", input_cache_read: "0.000001", input_cache_write: "0.0000125" } },
    { id: "~openai/gpt-sol-latest", alias_target: { slug: "openai/gpt-5.6-sol" }, pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000002", input_cache_write: "0.0000025" } },
    { id: "openai/gpt-sol-latest:batch", pricing: { prompt: "0.000001", completion: "0.000005" } },
    { id: "deepseek/deepseek-v4-flash-0731", pricing: { prompt: "0.000000065", completion: "0.00000018", input_cache_read: "0.000000016" } },
    { id: "somevendor/free-model", pricing: { prompt: "0", completion: "0" } },
    { id: "somevendor/no-pricing" },
  ]

  const first = await syncUpstreamPricing(pricingDbPath, now, fakeFetch(catalog))
  assert.deepEqual(first, {
    fetched: 6,
    inserted: 3,
    updated: 1,
    unchanged: 0,
    supersededDuplicates: 1,
    total: 4,
  })

  const rows = readRows(pricingDbPath)
  const active = new Map(rows.filter((row) => row.enabled === 1 && row.superseded_time === null).map((row) => [row.id, row]))

  const astra = active.get("openai:gpt-6-astra")
  assert.deepEqual(astra && {
    input: astra.input_price, output: astra.output_price, cacheRead: astra.cache_read_price, cacheWrite: astra.cache_write_price,
    source: astra.source_type, url: astra.source_url, vendorModelId: astra.vendor_model_id,
  }, {
    input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5,
    source: "upstream", url: UPSTREAM_PRICING_URL, vendorModelId: "openai/gpt-6-astra",
  })

  const sol = active.get("openai:gpt-5.6-sol")
  assert.ok(sol, "alias entry resolved to canonical slug identity")
  assert.equal(sol.vendor_model_id, "openai/gpt-5.6-sol")

  assert.ok(!active.has("openai/gpt-sol-latest:batch"), "batch entries are skipped")

  const deepseekFlash = active.get("deepseek:deepseek-v4-flash")
  assert.deepEqual(deepseekFlash && { source: deepseekFlash.source_type, input: deepseekFlash.input_price }, { source: "upstream", input: 0.065 })

  const archivedOfficial = rows.find((row) => row.id === "deepseek:deepseek-v4-flash:superseded:" + now)
  assert.ok(archivedOfficial, "official row archived under superseded id")
  assert.equal(archivedOfficial.enabled, 0)
  assert.equal(archivedOfficial.superseded_time, now)

  const supersededManual = rows.find((row) => row.id === "manual:deepseek:deepseek-v4-flash")
  assert.equal(supersededManual?.enabled, 0)
  assert.equal(supersededManual?.superseded_time, now)

  const free = active.get("somevendor:free-model")
  assert.deepEqual(free && { input: free.input_price, output: free.output_price }, { input: 0, output: 0 })

  assert.ok(!active.has("somevendor:no-pricing"), "entries without pricing are skipped")

  const second = await syncUpstreamPricing(pricingDbPath, now + 3_600, fakeFetch(catalog))
  assert.deepEqual(second, {
    fetched: 6,
    inserted: 0,
    updated: 0,
    unchanged: 4,
    supersededDuplicates: 0,
    total: 4,
  })
  assert.equal(readRows(pricingDbPath).length, rows.length)
})

test("syncUpstreamPricing keeps full identity when the date-stripped identity is unknown", async () => {
  const pricingDbPath = makePricingDb()
  const catalog = [
    { id: "somevendor/unknown-model-1234", pricing: { prompt: "0.000000065", completion: "0.00000018" } },
  ]

  await syncUpstreamPricing(pricingDbPath, now, fakeFetch(catalog))
  const rows = readRows(pricingDbPath)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "somevendor:unknown-model-1234")
  assert.equal(rows[0].input_price, 0.065)
})
