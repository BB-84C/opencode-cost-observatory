import type { ReasoningBillingRuleKind } from "./pricing-registry"

export type UsageCostDimensions = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type UsagePriceDimensions = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  reasoningBillingRule?: ReasoningBillingRuleKind
}

function priceTokens(tokens: number, usdPerMillionTokens: number) {
  return (tokens / 1_000_000) * usdPerMillionTokens
}

export function calculateUsageCost(usage: UsageCostDimensions, price: UsagePriceDimensions) {
  const inputUsd = priceTokens(usage.inputTokens, price.input)
  const outputUsd = priceTokens(usage.outputTokens, price.output)
  const reasoningUsd = price.reasoningBillingRule === "included_in_output"
    ? 0
    : priceTokens(usage.reasoningTokens, price.reasoning)
  const cacheReadUsd = priceTokens(usage.cacheReadTokens, price.cacheRead)
  const cacheWriteUsd = priceTokens(usage.cacheWriteTokens, price.cacheWrite)

  return {
    inputUsd,
    outputUsd,
    reasoningUsd,
    cacheReadUsd,
    cacheWriteUsd,
    totalUsd: inputUsd + outputUsd + reasoningUsd + cacheReadUsd + cacheWriteUsd,
  }
}
