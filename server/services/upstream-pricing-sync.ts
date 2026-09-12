import { openPricingDb } from "../storage/pricing-db"
import { pricing_record } from "../storage/schema.sql"
import { CURRENT_EFFECTIVE_PRICING_SEED } from "./current-effective-pricing"
import { createPricingRecordDraft, type PricingRecordDraft } from "./pricing-registry"

export const UPSTREAM_PRICING_URL = "https://openrouter.ai/api/v1/models"

export type UpstreamPricingSyncResult = {
  fetched: number
  inserted: number
  updated: number
  unchanged: number
  supersededDuplicates: number
  total: number
}

type CatalogEntry = {
  id: string
  name?: string
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string }
  alias_target?: { slug: string }
}

type PricingDb = ReturnType<typeof openPricingDb>
type StoredPricingRecord = PricingRecordDraft & { observed_time: number | null; superseded_time: number | null }

export function normalizeUpstreamIdentity(upstreamId: string, knownIdentities: Set<string>) {
  const slash = upstreamId.indexOf("/")
  if (slash < 0) return upstreamId.replace("/", ":")
  const vendor = upstreamId.slice(0, slash)
  const model = upstreamId.slice(slash + 1)
  const strippedModel = model.replace(/-\d{4}$/, "")
  const stripped = `${vendor}:${strippedModel}`
  return strippedModel !== model && knownIdentities.has(stripped) ? stripped : `${vendor}:${model}`
}

function pricePerMillion(value: string | undefined) {
  return value == null ? 0 : Math.max(0, Math.round(Number(value) * 1_000_000 * 1_000_000) / 1_000_000)
}

function isCurrentActiveRecord(record: StoredPricingRecord) { return record.enabled === 1 && record.superseded_time === null }

const businessFields: Array<keyof PricingRecordDraft> = [
  "canonical_vendor", "canonical_model", "vendor_model_id", "currency", "input_price", "output_price",
  "reasoning_price", "reasoning_billing_rule_json", "cache_read_price", "cache_write_price", "source_type",
  "source_url", "confidence", "is_manual_override",
]

function hasMatchingBusinessFields(existing: StoredPricingRecord, draft: PricingRecordDraft) {
  return businessFields.every((field) => existing[field] === draft[field])
}

function readRecord(db: PricingDb, id: string) {
  return db.sqlite.prepare("select * from pricing_record where id = ?").get(id) as StoredPricingRecord | undefined
}

function archiveRecord(db: PricingDb, id: string, now: number) {
  const base = `${id}:superseded:${now}`
  let candidate = base
  let suffix = 1
  while (readRecord(db, candidate)) candidate = `${base}:${suffix++}`
  db.sqlite.prepare("update pricing_record set id = ?, enabled = 0, superseded_time = coalesce(superseded_time, ?) where id = ?").run(candidate, now, id)
}

function runTransaction<T>(db: PricingDb, callback: () => T) {
  db.sqlite.exec("begin immediate")
  try { const result = callback(); db.sqlite.exec("commit"); return result } catch (error) { db.sqlite.exec("rollback"); throw error }
}

function makeDraft(entry: CatalogEntry, identity: string, now: number) {
  const [canonicalVendor, canonicalModel] = identity.split(":", 2)
  return createPricingRecordDraft({
    id: identity, canonicalVendor, canonicalModel, vendorModelId: entry.id, currency: "USD",
    inputPrice: pricePerMillion(entry.pricing?.prompt), outputPrice: pricePerMillion(entry.pricing?.completion),
    reasoningPrice: 0, reasoningBillingRule: { kind: "included_in_output", provenance: { sourceType: "upstream", sourceUrl: UPSTREAM_PRICING_URL } },
    cacheReadPrice: pricePerMillion(entry.pricing?.input_cache_read), cacheWritePrice: pricePerMillion(entry.pricing?.input_cache_write),
    sourceType: "upstream", sourceUrl: UPSTREAM_PRICING_URL, confidence: "high", isManualOverride: false,
    effectiveTime: now, observedTime: now, supersededTime: null, enabled: true,
  })
}

type ResolvedEntry = { entry: CatalogEntry; identity: string }

// Resolve identities to a fixpoint: date-suffixed ids strip to a base identity once
// that base identity exists among known identities OR among the resolved set itself,
// so one sync run converges regardless of the registry's starting state.
export function resolveUpstreamIdentities(entries: CatalogEntry[], knownIdentities: Iterable<string>): ResolvedEntry[] {
  const known = new Set(knownIdentities)
  let resolved: ResolvedEntry[] = entries.map((entry) => ({
    entry,
    identity: normalizeUpstreamIdentity(entry.id, known),
  }))

  for (let round = 0; round < 8; round++) {
    const candidates = new Set(resolved.map((item) => item.identity))
    let changed = false
    resolved = resolved.map((item) => {
      const identity = normalizeUpstreamIdentity(item.entry.id, candidates)
      if (identity !== item.identity) changed = true
      return { entry: item.entry, identity }
    })
    if (!changed) break
  }

  // When a suffixed and an unsuffixed entry resolve to the same identity, keep the unsuffixed one.
  const byIdentity = new Map<string, ResolvedEntry>()
  for (const item of resolved) {
    const existing = byIdentity.get(item.identity)
    if (!existing) {
      byIdentity.set(item.identity, item)
      continue
    }
    const isSuffixed = (entry: CatalogEntry) => /-\d{4}$/.test(entry.id.split("/").at(-1) ?? "")
    if (isSuffixed(existing.entry) && !isSuffixed(item.entry)) {
      byIdentity.set(item.identity, item)
    }
  }

  return [...byIdentity.values()]
}

export async function syncUpstreamPricing(pricingDbPath: string, now = Math.floor(Date.now() / 1000), fetchImpl: typeof fetch = fetch): Promise<UpstreamPricingSyncResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  let response: Response
  try {
    response = await fetchImpl(UPSTREAM_PRICING_URL, { signal: controller.signal })
    if (!response.ok) throw new Error(`OpenRouter pricing fetch failed with HTTP ${response.status}`)
  } finally { clearTimeout(timeout) }
  const catalog = await response.json() as { data: CatalogEntry[] }
  const entries = Array.isArray(catalog.data) ? catalog.data : []
  const db = openPricingDb(pricingDbPath)
  try {
    const known = new Set<string>([
      ...CURRENT_EFFECTIVE_PRICING_SEED.map((row) => row.id),
      ...(db.sqlite.prepare("select canonical_vendor, canonical_model from pricing_record").all() as Array<{ canonical_vendor: string; canonical_model: string }>).map((row) => `${row.canonical_vendor}:${row.canonical_model}`),
    ])
    const nonAliases = entries.filter((entry) => !entry.id.startsWith("~"))
    const aliases = entries.filter((entry) => entry.id.startsWith("~"))
    const eligible: CatalogEntry[] = []
    const resolvedUpstreamIds = new Set<string>()
    for (const entry of [...nonAliases, ...aliases]) {
      if (entry.id.endsWith(":batch") || entry.id.endsWith(":free") || !entry.pricing) continue
      const upstreamId = entry.id.startsWith("~") ? entry.alias_target?.slug : entry.id
      if (!upstreamId || resolvedUpstreamIds.has(upstreamId) || !upstreamId.includes("/")) continue
      resolvedUpstreamIds.add(upstreamId)
      eligible.push({ ...entry, id: upstreamId })
    }
    const drafts = resolveUpstreamIdentities(eligible, known).map((item) => makeDraft(item.entry, item.identity, now))
    return runTransaction(db, () => {
      const result: UpstreamPricingSyncResult = { fetched: entries.length, inserted: 0, updated: 0, unchanged: 0, supersededDuplicates: 0, total: drafts.length }
      for (const draft of drafts) {
        result.supersededDuplicates += db.sqlite.prepare(`update pricing_record set enabled = 0, superseded_time = ? where canonical_vendor = ? and canonical_model = ? and id <> ? and source_type <> 'upstream' and enabled = 1 and superseded_time is null`).run(now, draft.canonical_vendor, draft.canonical_model, draft.id).changes
        const existing = readRecord(db, draft.id)
        if (!existing) { db.insert(pricing_record).values(draft).run(); result.inserted++; continue }
        if (isCurrentActiveRecord(existing) && existing.source_type === "upstream" && hasMatchingBusinessFields(existing, draft)) { result.unchanged++; continue }
        archiveRecord(db, draft.id, now)
        db.insert(pricing_record).values(draft).run()
        result.updated++
      }
      return result
    })
  } finally { db.sqlite.close() }
}
