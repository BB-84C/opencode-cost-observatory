import { Router } from "express"
import { z } from "zod"

import { createPricingRecordDraft, sanitizePricingSourceUrl, type PricingRecordDraftInput, type PricingResolverRow } from "../services/pricing-registry"
import { tryRespondWithAnalyticsBusy } from "../services/sqlite-busy"
import { openAnalyticsDb } from "../storage/db"
import { openPricingDb } from "../storage/pricing-db"
import { pricing_record, sync_state } from "../storage/schema.sql"
import { readObservedPricingCoverage, readPricingRecords } from "../services/dashboard-analytics"
import { buildRequestCacheKey, dashboardPrivateResponseCache, sendJsonWithOptionalCache } from "../utils/response-cache"

const reasoningBillingRuleSchema = z.object({
  kind: z.enum(["per_token", "included_in_output"]),
  provenance: z.object({
    sourceType: z.enum(["manual", "official", "openrouter", "websearch"]),
    sourceUrl: z.string().min(1),
  }),
})

const pricingRecordCreateSchema = z.object({
  id: z.string().min(1),
  canonicalVendor: z.string().min(1),
  canonicalModel: z.string().min(1),
  vendorModelId: z.string().min(1),
  currency: z.string().min(1),
  inputPrice: z.number(),
  outputPrice: z.number(),
  reasoningPrice: z.number(),
  reasoningBillingRule: reasoningBillingRuleSchema.optional(),
  cacheReadPrice: z.number(),
  cacheWritePrice: z.number(),
  sourceType: z.enum(["manual", "official", "openrouter", "websearch"]),
  sourceUrl: z.string().min(1),
  confidence: z.string().min(1),
  isManualOverride: z.boolean(),
  effectiveTime: z.number().int(),
  observedTime: z.number().int().nullable().optional(),
  supersededTime: z.number().int().nullable().optional(),
  enabled: z.boolean().optional(),
})

const pricingRecordUpdateSchema = pricingRecordCreateSchema.omit({ id: true }).partial()

function badRequestMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "invalid pricing payload"
  }

  return error instanceof Error ? error.message : "invalid pricing payload"
}

function parseReasoningBillingRule(row: PricingResolverRow) {
  return (JSON.parse(row.reasoning_billing_rule_json) as PricingRecordDraftInput["reasoningBillingRule"] | undefined) ?? {
    kind: "per_token",
    provenance: {
      sourceType: row.source_type,
      sourceUrl: row.source_url,
    },
  }
}

function toApiRecord(row: PricingResolverRow) {
  const reasoningBillingRule = parseReasoningBillingRule(row)
  const safeSourceUrl = sanitizePricingSourceUrl(row.source_url)
  const safeReasoningSourceUrl = sanitizePricingSourceUrl(reasoningBillingRule.provenance.sourceUrl)

  return {
    id: row.id,
    canonicalVendor: row.canonical_vendor,
    canonicalModel: row.canonical_model,
    vendorModelId: row.vendor_model_id,
    currency: row.currency,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    reasoningPrice: row.reasoning_price,
    reasoningBillingRule: {
      ...reasoningBillingRule,
      provenance: {
        ...reasoningBillingRule.provenance,
        sourceUrl: safeReasoningSourceUrl,
      },
    },
    cacheReadPrice: row.cache_read_price,
    cacheWritePrice: row.cache_write_price,
    sourceType: row.source_type,
    sourceUrl: safeSourceUrl,
    confidence: row.confidence,
    isManualOverride: row.is_manual_override === 1,
    observedTime: row.observed_time ?? null,
    enabled: row.enabled === 1 || row.enabled === true,
    effectiveTime: row.effective_time,
    supersededTime: row.superseded_time ?? null,
  }
}

function toDraftInput(row: PricingResolverRow): PricingRecordDraftInput {
  return {
    id: row.id,
    canonicalVendor: row.canonical_vendor,
    canonicalModel: row.canonical_model,
    vendorModelId: row.vendor_model_id,
    currency: row.currency,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    reasoningPrice: row.reasoning_price,
    reasoningBillingRule: parseReasoningBillingRule(row),
    cacheReadPrice: row.cache_read_price,
    cacheWritePrice: row.cache_write_price,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    confidence: row.confidence,
    isManualOverride: row.is_manual_override === 1,
    effectiveTime: row.effective_time,
    observedTime: row.observed_time ?? null,
    supersededTime: row.superseded_time ?? null,
    enabled: row.enabled === 1 || row.enabled === true,
  }
}

function readPricingRecord(pricingDbPath: string, id: string) {
  return readPricingRecords(pricingDbPath).find((row) => row.id === id) ?? null
}

function buildSupersededPricingRecordId(id: string, supersededTime: number, effectiveTime: number) {
  return `${id}#superseded-${supersededTime}-${effectiveTime}`
}

function buildSupersededPricingRecordIdPrefix(id: string, supersededTime: number, effectiveTime: number) {
  return `${buildSupersededPricingRecordId(id, supersededTime, effectiveTime)}-`
}

function queuePricingRefresh(databasePath: string, now = Math.floor(Date.now() / 1000)) {
  const db = openAnalyticsDb(databasePath)

  try {
    db.insert(sync_state).values({
      key: "pricing_refresh_requested_at",
      value: String(now),
    }).onConflictDoUpdate({
      target: sync_state.key,
      set: { value: String(now) },
    }).run()

    return {
      queued: true,
      requestedAt: now,
      scope: "pricing",
    }
  } finally {
    db.sqlite.close()
  }
}

function insertPricingRecord(pricingDbPath: string, input: PricingRecordDraftInput) {
  const db = openPricingDb(pricingDbPath)

  try {
    db.insert(pricing_record).values(createPricingRecordDraft(input)).run()
  } finally {
    db.sqlite.close()
  }

  return readPricingRecord(pricingDbPath, input.id)
}

function updatePricingRecord(
  pricingDbPath: string,
  id: string,
  patch: z.infer<typeof pricingRecordUpdateSchema>,
  now = Math.floor(Date.now() / 1000),
) {
  const existing = readPricingRecord(pricingDbPath, id)

  if (!existing) {
    return null
  }

  if (!(existing.enabled === 1 || existing.enabled === true) || existing.superseded_time != null) {
    return null
  }

  const updated = createPricingRecordDraft({
    ...toDraftInput(existing),
    ...patch,
    id,
    effectiveTime: patch.effectiveTime ?? now,
    supersededTime: null,
    enabled: patch.enabled ?? true,
  })

  const db = openPricingDb(pricingDbPath)

  try {
    db.sqlite.exec("begin immediate")

    try {
      const archivePrefix = buildSupersededPricingRecordIdPrefix(existing.id, now, existing.effective_time)
      const archiveCount = db.sqlite.prepare(`
        select count(*) as total
        from pricing_record
        where id glob ?
      `).get(`${archivePrefix}*`) as { total: number }
      const archiveId = `${archivePrefix}${archiveCount.total}`

      db.insert(pricing_record).values({
        ...existing,
        id: archiveId,
        enabled: 0,
        superseded_time: now,
      }).run()

      db.insert(pricing_record).values(updated).onConflictDoUpdate({
        target: pricing_record.id,
        set: updated,
      }).run()

      db.sqlite.exec("commit")
    } catch (error) {
      db.sqlite.exec("rollback")
      throw error
    }
  } finally {
    db.sqlite.close()
  }

  return readPricingRecord(pricingDbPath, id)
}

type DashboardRouteOptions = { cachePrivateResponses?: boolean }

export function pricingRoutes(analyticsDbPath: string, pricingDbPath: string, options: DashboardRouteOptions = {}) {
  const router = Router()
  const cacheEnabled = options.cachePrivateResponses === true

  router.get("/pricing/records", (req, res) => {
    try {
      sendJsonWithOptionalCache(res, buildRequestCacheKey("pricing", req), cacheEnabled, () => ({ records: readPricingRecords(pricingDbPath).map(toApiRecord) }))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.get("/pricing/observed-coverage", (req, res) => {
    try {
      sendJsonWithOptionalCache(res, buildRequestCacheKey("pricing", req), cacheEnabled, () => ({ rows: readObservedPricingCoverage(analyticsDbPath, pricingDbPath) }))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.post("/pricing/refresh", (_req, res) => {
    try {
      if (cacheEnabled) dashboardPrivateResponseCache.clear()
      res.json(queuePricingRefresh(analyticsDbPath))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.post("/pricing/records", (req, res) => {
    try {
      const payload = pricingRecordCreateSchema.parse(req.body)
      const record = insertPricingRecord(pricingDbPath, payload)
      if (cacheEnabled) dashboardPrivateResponseCache.clear()
      res.status(201).json({ record: record ? toApiRecord(record) : null })
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      res.status(400).json({ error: badRequestMessage(error) })
    }
  })

  router.put("/pricing/records/:id", (req, res) => {
    try {
      const payload = pricingRecordUpdateSchema.parse(req.body)
      const record = updatePricingRecord(pricingDbPath, req.params.id, payload)

      if (!record) {
        res.status(404).json({ error: "pricing_record_not_found" })
        return
      }

      if (cacheEnabled) dashboardPrivateResponseCache.clear()
      res.json({ record: toApiRecord(record) })
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      res.status(400).json({ error: badRequestMessage(error) })
    }
  })

  router.delete("/pricing/records/:id", (req, res) => {
    let existing
    try {
      existing = readPricingRecord(pricingDbPath, req.params.id)
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }

    if (!existing) {
      res.status(404).json({ error: "pricing_record_not_found" })
      return
    }

    const now = Math.floor(Date.now() / 1000)

    try {
      const db = openPricingDb(pricingDbPath)
      try {
        db.sqlite.prepare(`
          update pricing_record
          set enabled = 0,
              superseded_time = coalesce(superseded_time, ?)
          where id = ?
        `).run(now, req.params.id)
      } finally {
        db.sqlite.close()
      }
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }

    if (cacheEnabled) dashboardPrivateResponseCache.clear()
    res.json({ deleted: true, id: req.params.id, tombstoned: true })
  })

  return router
}
