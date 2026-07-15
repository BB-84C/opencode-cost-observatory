import { openPricingDb } from "../storage/pricing-db"
import { pricing_record } from "../storage/schema.sql"
import { materializeCurrentEffectivePricingSeed } from "./current-effective-pricing"
import { createPricingRecordDraft, type PricingRecordDraft } from "./pricing-registry"

export type CurrentEffectivePricingSyncResult = {
  inserted: number
  updated: number
  unchanged: number
  total: number
}

type PricingDb = ReturnType<typeof openPricingDb>

type StoredPricingRecord = PricingRecordDraft & {
  observed_time: number | null
  superseded_time: number | null
}

const businessFields: Array<keyof PricingRecordDraft> = [
  "canonical_vendor",
  "canonical_model",
  "vendor_model_id",
  "currency",
  "input_price",
  "output_price",
  "reasoning_price",
  "reasoning_billing_rule_json",
  "cache_read_price",
  "cache_write_price",
  "source_type",
  "source_url",
  "confidence",
  "is_manual_override",
]

function readPricingRecord(db: PricingDb, id: string) {
  return db.sqlite.prepare("select * from pricing_record where id = ?").get(id) as StoredPricingRecord | undefined
}

function hasMatchingBusinessFields(existing: StoredPricingRecord, draft: PricingRecordDraft) {
  return businessFields.every((field) => existing[field] === draft[field])
}

function isCurrentActiveRecord(record: StoredPricingRecord) {
  return record.enabled === 1 && record.superseded_time === null
}

function nextArchiveId(db: PricingDb, id: string, now: number) {
  const base = `${id}:superseded:${now}`
  let candidate = base
  let suffix = 1

  while (readPricingRecord(db, candidate)) {
    candidate = `${base}:${suffix}`
    suffix += 1
  }

  return candidate
}

function runTransaction<T>(db: PricingDb, callback: () => T) {
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

function archivePricingRecord(db: PricingDb, id: string, now: number) {
  const archiveId = nextArchiveId(db, id, now)
  db.sqlite.prepare(`
    update pricing_record
    set id = ?, enabled = 0, superseded_time = coalesce(superseded_time, ?)
    where id = ?
  `).run(archiveId, now, id)
}

export function syncCurrentEffectivePricingSeed(pricingDbPath: string, now = Math.floor(Date.now() / 1000)): CurrentEffectivePricingSyncResult {
  const drafts = materializeCurrentEffectivePricingSeed(now).map(createPricingRecordDraft)
  const db = openPricingDb(pricingDbPath)

  try {
    return runTransaction(db, () => {
      const result: CurrentEffectivePricingSyncResult = {
        inserted: 0,
        updated: 0,
        unchanged: 0,
        total: drafts.length,
      }

      for (const draft of drafts) {
        const existing = readPricingRecord(db, draft.id)
        if (!existing) {
          db.insert(pricing_record).values(draft).run()
          result.inserted += 1
          continue
        }

        if (isCurrentActiveRecord(existing) && hasMatchingBusinessFields(existing, draft)) {
          result.unchanged += 1
          continue
        }

        archivePricingRecord(db, draft.id, now)
        db.insert(pricing_record).values(draft).run()
        result.updated += 1
      }

      return result
    })
  } finally {
    db.sqlite.close()
  }
}
