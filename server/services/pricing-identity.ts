const MODEL_ALIASES: Record<string, string> = {
  "k2p6": "kimi-2.6",
  "gpt-5.3-codex-spark": "gpt-5.3-codex",
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase()
}

export function normalizePricingModelKey(modelId: string) {
  const normalizedModelId = normalizeKeyPart(modelId)
  const slashIndex = normalizedModelId.indexOf("/")
  const unscopedModelId = slashIndex >= 0 ? normalizedModelId.slice(slashIndex + 1) : normalizedModelId
  return MODEL_ALIASES[unscopedModelId] ?? unscopedModelId
}

export function rowMatchesPricingModelKey(
  pricingModelKey: string,
  row: Pick<{ canonical_model: string; vendor_model_id: string }, "canonical_model" | "vendor_model_id">,
) {
  const normalizedPricingModelKey = normalizePricingModelKey(pricingModelKey)

  return normalizePricingModelKey(row.canonical_model) === normalizedPricingModelKey
    || normalizePricingModelKey(row.vendor_model_id) === normalizedPricingModelKey
}
