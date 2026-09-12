import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import Database from "better-sqlite3"

import { bootstrapAnalyticsDb } from "./db"
import { bootstrapPricingDb } from "./pricing-db"

const storageDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(storageDir, "../..")

function tableNames(file: string) {
  const sqlite = new Database(file, { readonly: true })
  try {
    const rows = sqlite.prepare("select name from sqlite_master where type = 'table' order by name asc").all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  } finally {
    sqlite.close()
  }
}

function indexNames(file: string) {
  const sqlite = new Database(file, { readonly: true })
  try {
    const rows = sqlite.prepare("select name from sqlite_master where type = 'index' order by name asc").all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  } finally {
    sqlite.close()
  }
}

function compileStorageFixture(source: string) {
  const fixturePath = path.join(storageDir, "__analytics-schema-typecheck.tmp.ts")
  const tsconfigPath = path.join(storageDir, "__analytics-schema-typecheck.tsconfig.json")
  const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc")

  fs.writeFileSync(fixturePath, source)
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    extends: "../../tsconfig.json",
    include: ["__analytics-schema-typecheck.tmp.ts", "../../types/**/*.d.ts"],
  }))

  try {
    execFileSync(process.execPath, [tscBin, "-p", tsconfigPath, "--pretty", "false"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    })
  } catch (error) {
    const typedError = error as { stdout?: string; stderr?: string }
    assert.fail(`${typedError.stdout ?? ""}${typedError.stderr ?? ""}`.trim())
  } finally {
    fs.rmSync(fixturePath, { force: true })
    fs.rmSync(tsconfigPath, { force: true })
  }
}

test("analytics bootstrap creates analytics tables without pricing tables", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-analytics-"))
  const analyticsDbPath = path.join(root, "analytics.db")

  bootstrapAnalyticsDb(analyticsDbPath)

  const tables = tableNames(analyticsDbPath)
  assert.equal(tables.includes("message_usage_fact"), true)
  assert.equal(tables.includes("session_tree_edge"), true)
  assert.equal(tables.includes("sync_state"), true)
  assert.equal(tables.includes("pricing_record"), false)
  assert.equal(tables.includes("pricing_source_event"), false)
})

test("analytics bootstrap creates message usage indexes for dashboard aggregates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-analytics-index-"))
  const analyticsDbPath = path.join(root, "analytics.db")

  bootstrapAnalyticsDb(analyticsDbPath)

  const indexes = indexNames(analyticsDbPath)
  assert.equal(indexes.includes("idx_muf_time_created"), true)
  assert.equal(indexes.includes("idx_muf_session_id"), true)
})

test("pricing bootstrap creates pricing tables without analytics tables", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-pricing-"))
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapPricingDb(pricingDbPath)

  const tables = tableNames(pricingDbPath)
  assert.equal(tables.includes("pricing_record"), true)
  assert.equal(tables.includes("pricing_source_event"), true)
  assert.equal(tables.includes("message_usage_fact"), false)
  assert.equal(tables.includes("session_tree_edge"), false)
  assert.equal(tables.includes("sync_state"), false)
})

test("analytics openers expose only analytics tables in their typed schema", () => {
  compileStorageFixture(`
    import { openAnalyticsDb, openAnalyticsReadonlyDb } from "./db"

    type Assert<T extends true> = T
    type AnalyticsSchema = ReturnType<typeof openAnalyticsDb>["_"]["fullSchema"]
    type AnalyticsReadonlySchema = ReturnType<typeof openAnalyticsReadonlyDb>["_"]["fullSchema"]

    type _AnalyticsHasUsageFacts = Assert<"message_usage_fact" extends keyof AnalyticsSchema ? true : false>
    type _AnalyticsHasSessionEdges = Assert<"session_tree_edge" extends keyof AnalyticsSchema ? true : false>
    type _AnalyticsHasSyncState = Assert<"sync_state" extends keyof AnalyticsSchema ? true : false>
    type _AnalyticsHasNoPricingRecord = Assert<"pricing_record" extends keyof AnalyticsSchema ? false : true>
    type _AnalyticsHasNoPricingEvents = Assert<"pricing_source_event" extends keyof AnalyticsSchema ? false : true>
    type _ReadonlyHasNoPricingRecord = Assert<"pricing_record" extends keyof AnalyticsReadonlySchema ? false : true>
    type _ReadonlyHasNoPricingEvents = Assert<"pricing_source_event" extends keyof AnalyticsReadonlySchema ? false : true>
  `)
})

test("pricing source events reject invalid source metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-pricing-event-"))
  const pricingDbPath = path.join(root, "pricing.db")

  bootstrapPricingDb(pricingDbPath)

  const sqlite = new Database(pricingDbPath)
  try {
    const insertSourceEvent = sqlite.prepare(`
      insert into pricing_source_event (id, pricing_record_id, source_type, source_url, observed_time, payload_json)
      values (?, ?, ?, ?, ?, ?)
    `)

    assert.throws(() => insertSourceEvent.run("event-invalid-type", "pricing-1", "scraped", "https://example.test", 1, null))
    assert.throws(() => insertSourceEvent.run("event-blank-url", "pricing-1", "official", "   ", 1, null))

    insertSourceEvent.run("event-valid", "pricing-1", "official", "https://example.test", 1, null)
  } finally {
    sqlite.close()
  }
})

test("pricing bootstrap rebuilds a legacy pricing_record whose source constraint predates the upstream source type", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-pricing-legacy-"))
  const pricingDbPath = path.join(root, "pricing.db")

  // Simulate a pre-upstream database: the named source_type constraint exists but lacks 'upstream'.
  const legacy = new Database(pricingDbPath)
  try {
    legacy.exec(`
      create table pricing_record (
        id text primary key,
        canonical_vendor text not null,
        canonical_model text not null,
        vendor_model_id text not null,
        currency text not null check(currency = 'USD'),
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
        enabled integer not null,
        constraint pricing_record_source_type_valid check(source_type = 'manual' or source_type = 'official' or source_type = 'openrouter' or source_type = 'websearch'),
        constraint pricing_record_source_url_non_blank check(length(trim(source_url)) > 0),
        constraint pricing_record_manual_override_coherent check((source_type = 'manual' and is_manual_override = 1) or (source_type <> 'manual' and is_manual_override = 0))
      );
    `)
    legacy.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency, input_price, output_price,
        reasoning_price, reasoning_billing_rule_json, cache_read_price, cache_write_price, source_type,
        source_url, confidence, is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:gpt-5.4", "openai", "gpt-5.4", "gpt-5.4", "USD", 2.5, 15, 15,
      JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      0.25, 0, "official", "https://developers.openai.com/api/docs/pricing", "high", 0, 1_746_493_200, 1_746_493_200, null, 1,
    )
  } finally {
    legacy.close()
  }

  // The legacy table must be rebuilt on open, and the rebuilt schema must accept upstream rows.
  bootstrapPricingDb(pricingDbPath)

  const sqlite = new Database(pricingDbPath)
  try {
    sqlite.prepare(`
      insert into pricing_record (
        id, canonical_vendor, canonical_model, vendor_model_id, currency, input_price, output_price,
        reasoning_price, reasoning_billing_rule_json, cache_read_price, cache_write_price, source_type,
        source_url, confidence, is_manual_override, effective_time, observed_time, superseded_time, enabled
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "openai:gpt-6-astra", "openai", "gpt-6-astra", "openai/gpt-6-astra", "USD", 10, 50, 0,
      JSON.stringify({ kind: "included_in_output", provenance: { sourceType: "upstream", sourceUrl: "https://openrouter.ai/api/v1/models" } }),
      1, 12.5, "upstream", "https://openrouter.ai/api/v1/models", "high", 0, 1_746_493_200, 1_746_493_200, null, 1,
    )

    const official = sqlite.prepare("select source_type, enabled from pricing_record where id = ?").get("openai:gpt-5.4") as { source_type: string; enabled: number }
    assert.deepEqual(official, { source_type: "official", enabled: 1 })

    const upstream = sqlite.prepare("select source_type from pricing_record where id = ?").get("openai:gpt-6-astra") as { source_type: string }
    assert.equal(upstream.source_type, "upstream")
  } finally {
    sqlite.close()
  }
})
