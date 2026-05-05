export type PricingSourceType = "manual" | "official" | "openrouter" | "websearch"

export type ReasoningBillingRuleKind = "per_token" | "included_in_output"

export type ReasoningBillingRuleInput = {
  kind: ReasoningBillingRuleKind
  provenance: {
    sourceType: PricingSourceType
    sourceUrl: string
  }
}

export type PricingResolverRow = {
  id: string
  canonical_vendor: string
  canonical_model: string
  vendor_model_id: string
  currency: string
  source_type: PricingSourceType
  source_url: string
  input_price: number
  output_price: number
  reasoning_price: number
  reasoning_billing_rule_json: string
  cache_read_price: number
  cache_write_price: number
  confidence: string
  is_manual_override: number
  observed_time?: number | null
  enabled: number | boolean
  effective_time: number
  superseded_time?: number | null
}

export type PricingRecordDraftInput = {
  id: string
  canonicalVendor: string
  canonicalModel: string
  vendorModelId: string
  currency: string
  inputPrice: number
  outputPrice: number
  reasoningPrice: number
  reasoningBillingRule?: ReasoningBillingRuleInput
  cacheReadPrice: number
  cacheWritePrice: number
  sourceType: PricingSourceType
  sourceUrl: string
  confidence: string
  isManualOverride: boolean
  effectiveTime: number
  observedTime?: number | null
  supersededTime?: number | null
  enabled?: boolean
}

export type PricingRecordDraft = {
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
  observed_time?: number | null
  superseded_time?: number | null
  enabled: 0 | 1
}

function normalizeCurrency(currency: string) {
  const normalized = currency.trim().toUpperCase()

  if (normalized !== "USD") {
    throw new Error("Pricing records must use USD currency")
  }

  return normalized
}

function validateNonNegativePriceDimensions(input: Pick<PricingRecordDraftInput, "inputPrice" | "outputPrice" | "reasoningPrice" | "cacheReadPrice" | "cacheWritePrice">) {
  const priceDimensions = [
    input.inputPrice,
    input.outputPrice,
    input.reasoningPrice,
    input.cacheReadPrice,
    input.cacheWritePrice,
  ]

  if (priceDimensions.some((value) => value < 0)) {
    throw new Error("Pricing records cannot include negative price dimensions")
  }
}

const precedenceRank: Record<PricingSourceType, number> = {
  official: 0,
  openrouter: 1,
  websearch: 2,
  manual: 3,
}

function normalizeSourceUrl(sourceUrl: string) {
  const normalized = sourceUrl.trim()

  if (!normalized) {
    throw new Error("Pricing records require a source URL")
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error("Pricing records require an http or https source URL")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Pricing records require an http or https source URL")
  }

  return normalized
}

function isSafeSourceUrl(sourceUrl: string) {
  try {
    normalizeSourceUrl(sourceUrl)
    return true
  } catch {
    return false
  }
}

export function sanitizePricingSourceUrl(sourceUrl: string | null | undefined) {
  if (sourceUrl == null) {
    return null
  }

  const trimmed = sourceUrl.trim()
  return trimmed && isSafeSourceUrl(trimmed) ? trimmed : null
}

function deriveManualOverride(sourceType: PricingSourceType) {
  return sourceType === "manual"
}

function normalizeManualOverride(sourceType: PricingSourceType, isManualOverride: boolean) {
  const derivedIsManualOverride = deriveManualOverride(sourceType)

  if (isManualOverride !== derivedIsManualOverride) {
    throw new Error("Pricing records require manual override state to match source type")
  }

  return derivedIsManualOverride
}

function normalizeReasoningBillingRule(
  reasoningBillingRule: ReasoningBillingRuleInput | undefined,
  fallback: Pick<PricingRecordDraftInput, "sourceType" | "sourceUrl">
) {
  return {
    kind: reasoningBillingRule?.kind ?? "per_token",
    provenance: {
      sourceType: reasoningBillingRule?.provenance.sourceType ?? fallback.sourceType,
      sourceUrl: normalizeSourceUrl(reasoningBillingRule?.provenance.sourceUrl ?? fallback.sourceUrl),
    },
  }
}

function isEnabled(value: number | boolean) {
  return value === true || value === 1
}

function normalizePricingUnixSeconds(value: number | null | undefined) {
  if (value == null) {
    return value
  }

  return value > 10_000_000_000 ? Math.floor(value / 1000) : value
}

function isEffective(row: PricingResolverRow, asOfTime: number) {
  return row.effective_time <= asOfTime && (row.superseded_time == null || row.superseded_time > asOfTime)
}

function normalizePricingRowTimes(row: PricingResolverRow): PricingResolverRow {
  return {
    ...row,
    effective_time: normalizePricingUnixSeconds(row.effective_time) ?? row.effective_time,
    observed_time: normalizePricingUnixSeconds(row.observed_time),
    superseded_time: normalizePricingUnixSeconds(row.superseded_time),
  }
}

function sortResolvedPrices(a: PricingResolverRow, b: PricingResolverRow) {
  const precedenceDifference = precedenceRank[a.source_type] - precedenceRank[b.source_type]

  if (precedenceDifference !== 0) {
    return precedenceDifference
  }

  const effectiveTimeDifference = b.effective_time - a.effective_time

  if (effectiveTimeDifference !== 0) {
    return effectiveTimeDifference
  }

  const observationTimeDifference = (b.observed_time ?? b.effective_time) - (a.observed_time ?? a.effective_time)

  if (observationTimeDifference !== 0) {
    return observationTimeDifference
  }

  return a.id.localeCompare(b.id)
}

export function resolveCanonicalPrice(rows: PricingResolverRow[], asOfTime = Math.floor(Date.now() / 1000)) {
  const normalizedAsOfTime = normalizePricingUnixSeconds(asOfTime) ?? asOfTime
  const candidates = [...rows]
    .map(normalizePricingRowTimes)
    .filter((row) => isEnabled(row.enabled))
    .flatMap((row) => {
      const normalizedSourceUrl = row.source_url.trim()
      return normalizedSourceUrl && isSafeSourceUrl(normalizedSourceUrl) ? [{ ...row, source_url: normalizedSourceUrl }] : []
    })

  const effective = candidates
    .filter((row) => isEffective(row, normalizedAsOfTime))
    .sort(sortResolvedPrices)[0]

  if (effective) {
    return effective
  }

  const firstKnown = candidates
    .filter((row) => normalizedAsOfTime < row.effective_time)
    .sort((a, b) => {
      const precedenceDifference = precedenceRank[a.source_type] - precedenceRank[b.source_type]

      if (precedenceDifference !== 0) {
        return precedenceDifference
      }

      const effectiveTimeDifference = a.effective_time - b.effective_time

      if (effectiveTimeDifference !== 0) {
        return effectiveTimeDifference
      }

      const observationTimeDifference = (a.observed_time ?? a.effective_time) - (b.observed_time ?? b.effective_time)

      if (observationTimeDifference !== 0) {
        return observationTimeDifference
      }

      return a.id.localeCompare(b.id)
    })[0]

  return firstKnown ?? null
}

export function createPricingRecordDraft(input: PricingRecordDraftInput): PricingRecordDraft {
  const normalizedSourceUrl = normalizeSourceUrl(input.sourceUrl)
  const isManualOverride = normalizeManualOverride(input.sourceType, input.isManualOverride)
  validateNonNegativePriceDimensions(input)

  return {
    id: input.id,
    canonical_vendor: input.canonicalVendor,
    canonical_model: input.canonicalModel,
    vendor_model_id: input.vendorModelId,
    currency: normalizeCurrency(input.currency),
    input_price: input.inputPrice,
    output_price: input.outputPrice,
    reasoning_price: input.reasoningPrice,
    reasoning_billing_rule_json: JSON.stringify(
      normalizeReasoningBillingRule(input.reasoningBillingRule, {
        sourceType: input.sourceType,
        sourceUrl: normalizedSourceUrl,
      })
    ),
    cache_read_price: input.cacheReadPrice,
    cache_write_price: input.cacheWritePrice,
    source_type: input.sourceType,
    source_url: normalizedSourceUrl,
    confidence: input.confidence,
    is_manual_override: isManualOverride ? 1 : 0,
    effective_time: input.effectiveTime,
    observed_time: input.observedTime,
    superseded_time: input.supersededTime,
    enabled: input.enabled ?? true ? 1 : 0,
  }
}
