import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { bootstrapAnalyticsDb, openAnalyticsDb } from "../storage/db"
import { openPricingDb, openPricingReadonlyDb } from "../storage/pricing-db"
import { pricing_record } from "../storage/schema.sql"
import { CURRENT_EFFECTIVE_PRICING_SEED } from "./current-effective-pricing"
import { createPricingRecordDraft } from "./pricing-registry"
import { ensurePricingRegistryReady } from "./pricing-recovery"

const now = 1_746_493_200
const currentEffectiveSeedCount = CURRENT_EFFECTIVE_PRICING_SEED.length

function activePricingRows(pricingDbPath: string) {
  const db = openPricingReadonlyDb(pricingDbPath)
  try {
    return db.sqlite.prepare(`
      select *
      from pricing_record
      where enabled = 1 and superseded_time is null
      order by canonical_vendor asc, canonical_model asc
    `).all() as Array<{
      id: string
      canonical_vendor: string
      canonical_model: string
      vendor_model_id: string
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
    }>
  } finally {
    db.sqlite.close()
  }
}

function insertPricingRecord(pricingDbPath: string) {
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.insert(pricing_record).values(createPricingRecordDraft({
      id: "openai:gpt-5.4",
      canonicalVendor: "openai",
      canonicalModel: "gpt-5.4",
      vendorModelId: "gpt-5.4",
      currency: "USD",
      inputPrice: 2.5,
      outputPrice: 15,
      reasoningPrice: 15,
      cacheReadPrice: 0.25,
      cacheWritePrice: 0,
      sourceType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      confidence: "high",
      isManualOverride: false,
      effectiveTime: now,
      observedTime: now,
      enabled: true,
    })).run()
  } finally {
    pricingDb.sqlite.close()
  }
}

function insertSupersededPricingRecord(pricingDbPath: string, id: string, canonicalModel: string) {
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.insert(pricing_record).values(createPricingRecordDraft({
      id,
      canonicalVendor: "openai",
      canonicalModel,
      vendorModelId: canonicalModel,
      currency: "USD",
      inputPrice: 99,
      outputPrice: 99,
      reasoningPrice: 99,
      cacheReadPrice: 0,
      cacheWritePrice: 0,
      sourceType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      confidence: "high",
      isManualOverride: false,
      effectiveTime: now - 120,
      observedTime: now - 120,
      supersededTime: now - 60,
      enabled: true,
    })).run()
  } finally {
    pricingDb.sqlite.close()
  }
}

function createLegacyPricingTable(analyticsDbPath: string) {
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  try {
    analyticsDb.sqlite.exec(`
      create table if not exists pricing_record (
        id text primary key,
        canonical_vendor text not null,
        canonical_model text not null,
        vendor_model_id text not null,
        currency text not null,
        input_price real not null,
        output_price real not null,
        reasoning_price real not null,
        reasoning_billing_rule_json text not null,
        cache_read_price real not null,
        cache_write_price real not null,
        source_type text not null,
        source_url text not null,
        confidence text not null,
        is_manual_override integer not null,
        effective_time integer not null,
        observed_time integer,
        superseded_time integer,
        enabled integer not null
      );
    `)
    analyticsDb.sqlite.prepare(`
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
      now,
      now,
      null,
      1,
    )
    analyticsDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:disabled",
      "openai",
      "disabled",
      "disabled",
      "USD",
      99,
      99,
      99,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now,
      now,
      null,
      0,
    )
  } finally {
    analyticsDb.sqlite.close()
  }
}

function createOlderLegacyPricingTable(analyticsDbPath: string) {
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  try {
    analyticsDb.sqlite.exec(`
      create table if not exists pricing_record (
        id text primary key,
        canonical_vendor text not null,
        canonical_model text not null,
        vendor_model_id text not null,
        currency text not null,
        input_price real not null,
        output_price real not null,
        reasoning_price real not null,
        cache_read_price real not null,
        cache_write_price real not null,
        source_type text not null,
        source_url text not null,
        confidence text not null,
        is_manual_override integer not null,
        effective_time integer not null,
        observed_time integer,
        enabled integer not null
      );
    `)
    analyticsDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:gpt-5.4",
      "openai",
      "gpt-5.4",
      "gpt-5.4",
      "USD",
      2.5,
      15,
      15,
      0.25,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now,
      now,
      1,
    )
  } finally {
    analyticsDb.sqlite.close()
  }
}

function createLegacyPricingTableWithPlaceholderSourceUrl(analyticsDbPath: string) {
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  try {
    analyticsDb.sqlite.exec(`
      create table if not exists pricing_record (
        id text primary key,
        canonical_vendor text not null,
        canonical_model text not null,
        vendor_model_id text not null,
        currency text not null,
        input_price real not null,
        output_price real not null,
        reasoning_price real not null,
        reasoning_billing_rule_json text not null,
        cache_read_price real not null,
        cache_write_price real not null,
        source_type text not null,
        source_url text not null,
        confidence text not null,
        is_manual_override integer not null,
        effective_time integer not null,
        observed_time integer,
        superseded_time integer,
        enabled integer not null
      );
    `)
    analyticsDb.sqlite.prepare(`
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
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "runtime-bootstrap" } }),
      0.25,
      0,
      "official",
      "runtime-bootstrap",
      "high",
      0,
      now,
      now,
      null,
      1,
    )
  } finally {
    analyticsDb.sqlite.close()
  }
}

function createLegacyPricingTableWithInvalidSecondRow(analyticsDbPath: string) {
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  try {
    analyticsDb.sqlite.exec(`
      create table if not exists pricing_record (
        id text primary key,
        canonical_vendor text not null,
        canonical_model text not null,
        vendor_model_id text not null,
        currency text not null,
        input_price real not null,
        output_price real not null,
        reasoning_price real not null,
        reasoning_billing_rule_json text not null,
        cache_read_price real not null,
        cache_write_price real not null,
        source_type text not null,
        source_url text not null,
        confidence text not null,
        is_manual_override integer not null,
        effective_time integer not null,
        observed_time integer,
        superseded_time integer,
        enabled integer not null
      );
    `)
    const insert = analyticsDb.sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json,
        cache_read_price, cache_write_price, source_type, source_url, confidence,
        is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insert.run(
      "openai:a-valid",
      "openai",
      "a-valid",
      "a-valid",
      "USD",
      1,
      2,
      2,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now,
      now,
      null,
      1,
    )
    insert.run(
      "openai:z-invalid",
      "openai",
      "z-invalid",
      "z-invalid",
      "EUR",
      1,
      2,
      2,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0,
      0,
      "official",
      "https://developers.openai.com/api/docs/pricing",
      "high",
      0,
      now,
      now,
      null,
      1,
    )
  } finally {
    analyticsDb.sqlite.close()
  }
}

test("ensurePricingRegistryReady keeps an existing pricing registry untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-existing-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)
  insertPricingRecord(pricingDbPath)

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)

  assert.equal(result.source, "existing")
  assert.equal(result.inserted, 0)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "openai:gpt-5.4")
  assert.equal(rows[0].input_price, 2.5)
})

test("ensurePricingRegistryReady ignores superseded durable rows when deciding registry readiness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-superseded-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.insert(pricing_record).values(createPricingRecordDraft({
      id: "openai:gpt-5.4-old",
      canonicalVendor: "openai",
      canonicalModel: "gpt-5.4-old",
      vendorModelId: "gpt-5.4-old",
      currency: "USD",
      inputPrice: 2.5,
      outputPrice: 15,
      reasoningPrice: 15,
      cacheReadPrice: 0.25,
      cacheWritePrice: 0,
      sourceType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      confidence: "high",
      isManualOverride: false,
      effectiveTime: now - 120,
      observedTime: now - 120,
      supersededTime: now - 60,
      enabled: true,
    })).run()
  } finally {
    pricingDb.sqlite.close()
  }

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)

  assert.equal(result.source, "seed")
  assert.equal(result.inserted, currentEffectiveSeedCount)
  assert.equal(rows.length, currentEffectiveSeedCount)
})

test("ensurePricingRegistryReady migrates active legacy rows before seeding", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-legacy-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  createLegacyPricingTable(analyticsDbPath)

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)

  assert.equal(result.source, "legacy-analytics")
  assert.equal(result.inserted, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "openai:gpt-5.4")
  assert.equal(rows[0].input_price, 2.5)
})

test("ensurePricingRegistryReady overwrites same-id superseded rows during legacy migration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-legacy-tombstone-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  createLegacyPricingTable(analyticsDbPath)
  insertSupersededPricingRecord(pricingDbPath, "openai:gpt-5.4", "gpt-5.4")

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)

  assert.equal(result.source, "legacy-analytics")
  assert.equal(result.inserted, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "openai:gpt-5.4")
  assert.equal(rows[0].input_price, 2.5)
})

test("ensurePricingRegistryReady migrates older legacy rows without reasoning billing metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-older-legacy-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  createOlderLegacyPricingTable(analyticsDbPath)

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)

  assert.equal(result.source, "legacy-analytics")
  assert.equal(result.inserted, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "openai:gpt-5.4")
  assert.deepEqual(JSON.parse(rows[0].reasoning_billing_rule_json), {
    kind: "per_token",
    provenance: {
      sourceType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
    },
  })
})

test("ensurePricingRegistryReady sanitizes placeholder legacy source URLs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-placeholder-url-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  createLegacyPricingTableWithPlaceholderSourceUrl(analyticsDbPath)

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)
  const reasoningBillingRule = JSON.parse(rows[0].reasoning_billing_rule_json) as { provenance: { sourceUrl: string } }

  assert.equal(result.source, "legacy-analytics")
  assert.equal(result.inserted, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source_url, "https://localhost/pricing-recovery/legacy")
  assert.equal(reasoningBillingRule.provenance.sourceUrl, "https://localhost/pricing-recovery/legacy")
})

test("ensurePricingRegistryReady rolls back partial legacy migrations when an insert fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-rollback-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  createLegacyPricingTableWithInvalidSecondRow(analyticsDbPath)

  assert.throws(
    () => ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now),
    /Pricing records must use USD currency/,
  )
  assert.equal(activePricingRows(pricingDbPath).length, 0)
})

test("ensurePricingRegistryReady seeds current effective rows when no durable or legacy rows exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-seed-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)
  const models = new Map(rows.map((row) => [row.canonical_model, row]))

  assert.equal(result.source, "seed")
  assert.equal(result.inserted, currentEffectiveSeedCount)
  assert.equal(rows.length, currentEffectiveSeedCount)
  assert.equal(models.get("gpt-5.5")?.input_price, 5)
  assert.equal(models.get("gpt-5.5")?.cache_read_price, 0.5)
  assert.equal(models.get("gpt-5.5-pro")?.input_price, 30)
  assert.equal(models.get("claude-opus-4-7")?.cache_write_price, 6.25)
  assert.equal(models.get("claude-sonnet-4-6")?.cache_read_price, 0.3)
  assert.equal(models.get("kimi-2.6")?.vendor_model_id, "kimi-2.6")
  assert.equal(models.get("kimi-2.6")?.input_price, 0.95)
  assert.equal(models.get("kimi-2.6")?.output_price, 4)
  assert.equal(models.get("kimi-2.6")?.cache_read_price, 0.16)
  assert.equal(models.get("kimi-2.6")?.source_url, "https://platform.kimi.ai/docs/pricing/chat-k26")
  assert.equal(rows.every((row) => row.effective_time === now && row.observed_time === now), true)
})

test("ensurePricingRegistryReady overwrites same-id superseded rows during seed recovery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-recovery-seed-tombstone-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapAnalyticsDb(analyticsDbPath)
  insertSupersededPricingRecord(pricingDbPath, "openai:gpt-5.5", "gpt-5.5")

  const result = ensurePricingRegistryReady(analyticsDbPath, pricingDbPath, now)
  const rows = activePricingRows(pricingDbPath)
  const models = new Map(rows.map((row) => [row.canonical_model, row]))

  assert.equal(result.source, "seed")
  assert.equal(result.inserted, currentEffectiveSeedCount)
  assert.equal(rows.length, currentEffectiveSeedCount)
  assert.equal(models.get("gpt-5.5")?.id, "openai:gpt-5.5")
  assert.equal(models.get("gpt-5.5")?.input_price, 5)
})
