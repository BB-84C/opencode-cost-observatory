const MODEL_ALIASES: Record<string, string> = {
  k2p6: "kimi-2.6",
  "gpt-5.3-codex-spark": "gpt-5.3-codex",
}

const TRANSPORT_PROVIDER_CANONICAL_VENDOR: Record<string, string> = {
  "gauge-forge-openai": "openai",
}

const CANONICAL_VENDOR_BY_MODEL_PREFIX: Array<[RegExp, string]> = [
  [/^(gpt-|o\d|codex)/, "openai"],
  [/^claude-/, "anthropic"],
  [/^kimi-/, "moonshot"],
]

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase()
}

function pricingRecordIdPart(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "unknown"
}

export function normalizePricingModelKey(modelId: string) {
  const normalizedModelId = normalizeKeyPart(modelId)
  const slashIndex = normalizedModelId.indexOf("/")
  const unscopedModelId = slashIndex >= 0 ? normalizedModelId.slice(slashIndex + 1) : normalizedModelId
  return MODEL_ALIASES[unscopedModelId] ?? unscopedModelId
}

function inferCanonicalVendor(providerId: string, modelId: string, canonicalModel: string) {
  const normalizedProviderId = normalizeKeyPart(providerId)
  const normalizedModelId = normalizeKeyPart(modelId)
  const slashIndex = normalizedModelId.indexOf("/")

  if (slashIndex > 0) {
    const scopedVendor = normalizedModelId.slice(0, slashIndex)
    return TRANSPORT_PROVIDER_CANONICAL_VENDOR[scopedVendor] ?? scopedVendor
  }

  const transportVendor = TRANSPORT_PROVIDER_CANONICAL_VENDOR[normalizedProviderId]
  if (transportVendor) {
    return transportVendor
  }

  const modelVendor = CANONICAL_VENDOR_BY_MODEL_PREFIX.find(([pattern]) => pattern.test(canonicalModel))?.[1]
  if (modelVendor) {
    return modelVendor
  }

  return normalizedProviderId
}

export function deriveManualPricingIdentity(input: { providerId: string; modelId: string }) {
  const canonicalModel = normalizePricingModelKey(input.modelId)
  const canonicalVendor = inferCanonicalVendor(input.providerId, input.modelId, canonicalModel)

  return {
    id: `price-${pricingRecordIdPart(canonicalVendor)}-${pricingRecordIdPart(canonicalModel)}-manual`,
    canonicalVendor,
    canonicalModel,
    vendorModelId: canonicalModel,
  }
}
