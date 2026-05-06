import { openAnalyticsReadonlyDb } from "../storage/db"
import { openPricingDb } from "../storage/pricing-db"
import { materializeCurrentEffectivePricingSeed } from "./current-effective-pricing"
import { normalizePricingModelKey } from "./pricing-identity"
import { createPricingRecordDraft, type PricingRecordDraft, type PricingRecordDraftInput, type PricingSourceType, type ReasoningBillingRuleInput } from "./pricing-registry"

type RecoverySource = "existing" | "legacy-analytics" | "seed"
type PricingDb = ReturnType<typeof openPricingDb>

const LEGACY_RECOVERY_SOURCE_URL = "https://localhost/pricing-recovery/legacy"
const CODEX_CANONICAL_PRICING_ID = "openai:gpt-5.3-codex"
const CODEX_CANONICAL_MODEL = "gpt-5.3-codex"

type LegacyPricingRow = {
  id: string
  canonical_vendor: string
  canonical_model: string
  vendor_model_id: string
  currency: string
  input_price: number
  output_price: number
  reasoning_price: number
  reasoning_billing_rule_json: string | null
  cache_read_price: number
  cache_write_price: number
  source_type: string
  source_url: string
  confidence: string
  is_manual_override: number
  effective_time: number
  observed_time: number | null
  superseded_time: number | null
  enabled: number
}

type ActivePricingRow = {
  id: string
  canonical_vendor: string
  canonical_model: string
  vendor_model_id: string
  currency: string
  input_price: number
  output_price: number
  reasoning_price: number
  reasoning_billing_rule_json: string
  cache_read_price: number
  cache_write_price: number
  source_type: PricingSourceType
  source_url: string
  confidence: string
  is_manual_override: 0 | 1
  effective_time: number
  observed_time: number | null
  superseded_time: number | null
  enabled: 0 | 1
}

export type PricingRecoveryResult = {
  source: RecoverySource
  inserted: number
}

function hasTable(sqlite: { prepare: (sql: string) => { get: (...params: unknown[]) => unknown } }, tableName: string) {
  const row = sqlite.prepare("select count(*) as total from sqlite_master where type = 'table' and name = ?").get(tableName) as { total: number }
  return row.total > 0
}

function tableColumns(sqlite: { prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] } }, tableName: string) {
  return new Set(
    (sqlite.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name),
  )
}

function selectLegacyColumn(columns: Set<string>, name: keyof LegacyPricingRow, fallbackSql: string) {
  return columns.has(name) ? name : `${fallbackSql} as ${name}`
}

function activeDurablePricingCount(db: PricingDb) {
  const row = db.sqlite.prepare("select count(*) as total from pricing_record where enabled = 1 and superseded_time is null").get() as { total: number }
  return row.total
}

function normalizeUnaliasedPricingModelKey(modelId: string) {
  const normalizedModelId = modelId.trim().toLowerCase()
  const slashIndex = normalizedModelId.indexOf("/")
  return slashIndex >= 0 ? normalizedModelId.slice(slashIndex + 1) : normalizedModelId
}

function readActivePricingRows(db: PricingDb) {
  return db.sqlite.prepare(`
    select id, canonical_vendor, canonical_model, vendor_model_id, currency,
      input_price, output_price, reasoning_price, reasoning_billing_rule_json,
      cache_read_price, cache_write_price, source_type, source_url, confidence,
      is_manual_override, effective_time, observed_time, superseded_time, enabled
    from pricing_record
    where enabled = 1 and superseded_time is null
    order by effective_time desc, coalesce(observed_time, effective_time) desc, id asc
  `).all() as ActivePricingRow[]
}

function isCanonicalCodexRow(row: ActivePricingRow) {
  return normalizeUnaliasedPricingModelKey(row.canonical_model) === CODEX_CANONICAL_MODEL
}

function isSparkLikeCodexAliasRow(row: ActivePricingRow) {
  return [row.canonical_model, row.vendor_model_id].some((modelId) => {
    return normalizePricingModelKey(modelId) === CODEX_CANONICAL_MODEL
      && normalizeUnaliasedPricingModelKey(modelId) !== CODEX_CANONICAL_MODEL
  })
}

function writeCodexCanonicalRowFromSparkAlias(db: PricingDb, row: ActivePricingRow) {
  writeRecoveredPricingRecord(db, {
    id: CODEX_CANONICAL_PRICING_ID,
    canonical_vendor: "openai",
    canonical_model: CODEX_CANONICAL_MODEL,
    vendor_model_id: CODEX_CANONICAL_MODEL,
    currency: row.currency,
    input_price: row.input_price,
    output_price: row.output_price,
    reasoning_price: row.reasoning_price,
    reasoning_billing_rule_json: row.reasoning_billing_rule_json,
    cache_read_price: row.cache_read_price,
    cache_write_price: row.cache_write_price,
    source_type: row.source_type,
    source_url: row.source_url,
    confidence: row.confidence,
    is_manual_override: row.is_manual_override,
    effective_time: row.effective_time,
    observed_time: row.observed_time,
    superseded_time: null,
    enabled: 1,
  })
}

function repairSparkAliasRows(db: PricingDb, now: number) {
  runPricingTransaction(db, () => {
    const activeRows = readActivePricingRows(db)
    const sparkLikeRows = activeRows.filter(isSparkLikeCodexAliasRow)

    if (sparkLikeRows.length === 0) {
      return
    }

    const codex = activeRows.find((row) => isCanonicalCodexRow(row) && !isSparkLikeCodexAliasRow(row))
    if (!codex) {
      writeCodexCanonicalRowFromSparkAlias(db, sparkLikeRows[0])
    }

    const tombstone = db.sqlite.prepare(`
      update pricing_record
      set enabled = 0,
          superseded_time = coalesce(superseded_time, ?)
      where id = ?
    `)

    for (const row of sparkLikeRows) {
      if (row.id !== CODEX_CANONICAL_PRICING_ID) {
        tombstone.run(now, row.id)
      }
    }
  })
}

function readActiveLegacyPricingRows(analyticsDbPath: string, now: number) {
  const db = openAnalyticsReadonlyDb(analyticsDbPath)
  try {
    if (!hasTable(db.sqlite, "pricing_record")) {
      return []
    }

    const columns = tableColumns(db.sqlite, "pricing_record")
    const activePredicate = columns.has("enabled") ? "enabled = 1" : "1 = 1"
    const supersededPredicate = columns.has("superseded_time") ? "and superseded_time is null" : ""
    const orderBy = [
      columns.has("canonical_vendor") ? "canonical_vendor asc" : null,
      columns.has("canonical_model") ? "canonical_model asc" : null,
      columns.has("effective_time") ? "effective_time desc" : null,
    ].filter(Boolean).join(", ") || "id asc"
    const legacySelect = [
      selectLegacyColumn(columns, "id", "''"),
      selectLegacyColumn(columns, "canonical_vendor", "'unknown'"),
      selectLegacyColumn(columns, "canonical_model", "vendor_model_id"),
      selectLegacyColumn(columns, "vendor_model_id", "canonical_model"),
      selectLegacyColumn(columns, "currency", "'USD'"),
      selectLegacyColumn(columns, "input_price", "0"),
      selectLegacyColumn(columns, "output_price", "0"),
      selectLegacyColumn(columns, "reasoning_price", "0"),
      selectLegacyColumn(columns, "reasoning_billing_rule_json", "null"),
      selectLegacyColumn(columns, "cache_read_price", "0"),
      selectLegacyColumn(columns, "cache_write_price", "0"),
      selectLegacyColumn(columns, "source_type", "'websearch'"),
      selectLegacyColumn(columns, "source_url", `'${LEGACY_RECOVERY_SOURCE_URL}'`),
      selectLegacyColumn(columns, "confidence", "'medium'"),
      selectLegacyColumn(columns, "is_manual_override", "0"),
      selectLegacyColumn(columns, "effective_time", String(now)),
      selectLegacyColumn(columns, "observed_time", "null"),
      selectLegacyColumn(columns, "superseded_time", "null"),
      selectLegacyColumn(columns, "enabled", "1"),
    ].join(",\n        ")

    return db.sqlite.prepare(`
      select ${legacySelect}
      from pricing_record
      where ${activePredicate} ${supersededPredicate}
      order by ${orderBy}
    `).all() as LegacyPricingRow[]
  } finally {
    db.sqlite.close()
  }
}

function normalizePricingSourceType(value: string): PricingSourceType {
  return value === "manual" || value === "official" || value === "openrouter" || value === "websearch"
    ? value
    : "websearch"
}

function normalizeLegacySourceUrl(value: string) {
  try {
    const url = new URL(value.trim())
    if (url.protocol === "http:" || url.protocol === "https:") {
      return value.trim()
    }
  } catch {
    return LEGACY_RECOVERY_SOURCE_URL
  }

  return LEGACY_RECOVERY_SOURCE_URL
}

function runPricingTransaction<T>(db: PricingDb, callback: () => T) {
  db.sqlite.exec("begin immediate")
  try {
    const result = callback()
    db.sqlite.exec("commit")
    return result
  } catch (error) {
    db.sqlite.exec("rollback")
    throw error
  }
}

function writeRecoveredPricingRecord(db: PricingDb, draft: PricingRecordDraft) {
  db.sqlite.prepare(`
    insert or replace into pricing_record (
      id, canonical_vendor, canonical_model, vendor_model_id, currency,
      input_price, output_price, reasoning_price, reasoning_billing_rule_json,
      cache_read_price, cache_write_price, source_type, source_url, confidence,
      is_manual_override, effective_time, observed_time, superseded_time, enabled
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.id,
    draft.canonical_vendor,
    draft.canonical_model,
    draft.vendor_model_id,
    draft.currency,
    draft.input_price,
    draft.output_price,
    draft.reasoning_price,
    draft.reasoning_billing_rule_json,
    draft.cache_read_price,
    draft.cache_write_price,
    draft.source_type,
    draft.source_url,
    draft.confidence,
    draft.is_manual_override,
    draft.effective_time,
    draft.observed_time,
    draft.superseded_time,
    draft.enabled,
  )
}

function writeRecoveredPricingRecordInput(db: PricingDb, input: PricingRecordDraftInput) {
  writeRecoveredPricingRecord(db, createPricingRecordDraft(input))
}

function parseReasoningBillingRule(value: string | null): ReasoningBillingRuleInput | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as Partial<ReasoningBillingRuleInput>
    if (
      (parsed.kind === "per_token" || parsed.kind === "included_in_output")
      && parsed.provenance
      && typeof parsed.provenance.sourceType === "string"
      && typeof parsed.provenance.sourceUrl === "string"
    ) {
      return {
        kind: parsed.kind,
        provenance: {
          sourceType: normalizePricingSourceType(parsed.provenance.sourceType),
          sourceUrl: normalizeLegacySourceUrl(parsed.provenance.sourceUrl),
        },
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function insertLegacyPricingRows(db: PricingDb, legacyRows: LegacyPricingRow[]) {
  runPricingTransaction(db, () => {
    for (const row of legacyRows) {
      const sourceType = normalizePricingSourceType(row.source_type)
      const sourceUrl = normalizeLegacySourceUrl(row.source_url)
      writeRecoveredPricingRecordInput(db, {
        id: row.id,
        canonicalVendor: row.canonical_vendor,
        canonicalModel: row.canonical_model,
        vendorModelId: row.vendor_model_id,
        currency: row.currency,
        inputPrice: row.input_price,
        outputPrice: row.output_price,
        reasoningPrice: row.reasoning_price,
        reasoningBillingRule: parseReasoningBillingRule(row.reasoning_billing_rule_json),
        cacheReadPrice: row.cache_read_price,
        cacheWritePrice: row.cache_write_price,
        sourceType,
        sourceUrl,
        confidence: row.confidence,
        isManualOverride: sourceType === "manual",
        effectiveTime: row.effective_time,
        observedTime: row.observed_time,
        supersededTime: null,
        enabled: row.enabled === 1,
      })
    }
  })
}

function insertCurrentEffectiveSeed(db: PricingDb, now: number) {
  return runPricingTransaction(db, () => {
    const rows = materializeCurrentEffectivePricingSeed(now)
    for (const row of rows) {
      writeRecoveredPricingRecordInput(db, row)
    }
    return rows.length
  })
}

export function ensurePricingRegistryReady(
  analyticsDbPath: string,
  pricingDbPath: string,
  now = Math.floor(Date.now() / 1000),
): PricingRecoveryResult {
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    repairSparkAliasRows(pricingDb, now)

    if (activeDurablePricingCount(pricingDb) > 0) {
      return { source: "existing", inserted: 0 }
    }

    const legacyRows = readActiveLegacyPricingRows(analyticsDbPath, now)
    if (legacyRows.length > 0) {
      insertLegacyPricingRows(pricingDb, legacyRows)
      repairSparkAliasRows(pricingDb, now)
      return { source: "legacy-analytics", inserted: legacyRows.length }
    }

    const inserted = insertCurrentEffectiveSeed(pricingDb, now)
    repairSparkAliasRows(pricingDb, now)
    return { source: "seed", inserted }
  } finally {
    pricingDb.sqlite.close()
  }
}
