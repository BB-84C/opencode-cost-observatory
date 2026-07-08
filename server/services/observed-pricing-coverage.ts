import { rowMatchesPricingModelKey } from "./pricing-identity"
import { resolveCanonicalPrice, type PricingResolverRow } from "./pricing-registry"

type UsageLike = {
  provider_id: string
  model_id: string
  time_created: number
  total_tokens: number
  message_count?: number
}

export type ObservedPricingCoverageRow = {
  observedProviderId: string
  observedModelId: string
  canonicalRecordId: string | null
  canonicalVendor: string | null
  canonicalModel: string | null
  vendorModelId: string | null
  sourceType: PricingResolverRow["source_type"] | null
  sourceUrl: string | null
  confidence: string | null
  inputPrice: number | null
  outputPrice: number | null
  reasoningPrice: number | null
  cacheReadPrice: number | null
  cacheWritePrice: number | null
  messageCount: number
  totalTokens: number
  firstSeen: number
  lastSeen: number
  resolutionStatus: "priced" | "missing"
}

function normalizeAnalyticsUnixSeconds(value: number) {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value
}

function isEffectiveAt(row: PricingResolverRow, asOfTime: number) {
  const effectiveTime = normalizeAnalyticsUnixSeconds(row.effective_time)
  const supersededTime = row.superseded_time == null ? null : normalizeAnalyticsUnixSeconds(row.superseded_time)

  return effectiveTime <= asOfTime && (supersededTime == null || supersededTime > asOfTime)
}

function resolveEffectiveCanonicalPrice(rows: PricingResolverRow[], asOfTime: number) {
  const resolved = resolveCanonicalPrice(rows, asOfTime)
  return resolved && isEffectiveAt(resolved, asOfTime) ? resolved : null
}

export function buildObservedPricingCoverageRows(args: {
  usageFacts: UsageLike[]
  pricingRows: PricingResolverRow[]
  asOfTime: number
}): ObservedPricingCoverageRow[] {
  const grouped = new Map<string, ObservedPricingCoverageRow>()
  const asOfTime = normalizeAnalyticsUnixSeconds(args.asOfTime)

  for (const usage of args.usageFacts) {
    const key = `${usage.provider_id}\u0000${usage.model_id}`
    const usageTime = normalizeAnalyticsUnixSeconds(usage.time_created)
    const candidates = args.pricingRows.filter((row) => rowMatchesPricingModelKey(usage.model_id, row))
    const resolved = candidates.length > 0 ? resolveEffectiveCanonicalPrice(candidates, asOfTime) : null
    const existing = grouped.get(key)
    const messageCount = usage.message_count ?? 1

    if (existing) {
      existing.messageCount += messageCount
      existing.totalTokens += usage.total_tokens
      existing.firstSeen = Math.min(existing.firstSeen, usageTime)
      existing.lastSeen = Math.max(existing.lastSeen, usageTime)
      continue
    }

    grouped.set(key, {
      observedProviderId: usage.provider_id,
      observedModelId: usage.model_id,
      canonicalRecordId: resolved?.id ?? null,
      canonicalVendor: resolved?.canonical_vendor ?? null,
      canonicalModel: resolved?.canonical_model ?? null,
      vendorModelId: resolved?.vendor_model_id ?? null,
      sourceType: resolved?.source_type ?? null,
      sourceUrl: resolved?.source_url ?? null,
      confidence: resolved?.confidence ?? null,
      inputPrice: resolved?.input_price ?? null,
      outputPrice: resolved?.output_price ?? null,
      reasoningPrice: resolved?.reasoning_price ?? null,
      cacheReadPrice: resolved?.cache_read_price ?? null,
      cacheWritePrice: resolved?.cache_write_price ?? null,
      messageCount,
      totalTokens: usage.total_tokens,
      firstSeen: usageTime,
      lastSeen: usageTime,
      resolutionStatus: resolved ? "priced" : "missing",
    })
  }

  return [...grouped.values()].sort((a, b) => (
    b.totalTokens - a.totalTokens
    || a.observedProviderId.localeCompare(b.observedProviderId)
    || a.observedModelId.localeCompare(b.observedModelId)
  ))
}
