const MODEL_ALIASES: Record<string, string> = {
  "k2p6": "kimi-2.6",
  "gpt-5.3-codex-spark": "gpt-5.3-codex",
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase()
}

/**
 * Provider-agnostic model key: strips any transport-provider / vendor path
 * prefix (e.g. "openrouter/anthropic/claude-x" -> "claude-x") and lowercases,
 * so the same model served by different providers is one band. The pricing
 * aliases are intentionally NOT applied here — this is a display key.
 */
export function providerAgnosticModelKey(modelId: string) {
  const normalizedModelId = normalizeKeyPart(modelId)
  const slashIndex = normalizedModelId.lastIndexOf("/")
  return slashIndex >= 0 ? normalizedModelId.slice(slashIndex + 1) : normalizedModelId
}

/** Display name for a model band: the last path segment of the raw id. */
export function providerAgnosticModelLabel(modelId: string) {
  const trimmed = modelId.trim()
  const slashIndex = trimmed.lastIndexOf("/")
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed
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
