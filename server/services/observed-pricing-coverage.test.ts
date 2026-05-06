import assert from "node:assert/strict"
import test from "node:test"

import { normalizePricingModelKey } from "./pricing-identity"
import { buildObservedPricingCoverageRows } from "./observed-pricing-coverage"
import type { PricingResolverRow } from "./pricing-registry"

function officialPricingRow(input: {
  id: string
  modelId: string
  effectiveTime: number
  supersededTime?: number | null
}): PricingResolverRow {
  return {
    id: input.id,
    canonical_vendor: "openai",
    canonical_model: input.modelId,
    vendor_model_id: input.modelId,
    currency: "USD",
    input_price: 2.5,
    output_price: 15,
    reasoning_price: 15,
    reasoning_billing_rule_json: JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
    cache_read_price: 0.25,
    cache_write_price: 0,
    source_type: "official",
    source_url: "https://developers.openai.com/api/docs/pricing",
    confidence: "high",
    is_manual_override: 0,
    observed_time: input.effectiveTime,
    enabled: 1,
    effective_time: input.effectiveTime,
    superseded_time: input.supersededTime ?? null,
  }
}

test("normalizePricingModelKey aliases gpt-5.3-codex-spark to gpt-5.3-codex", () => {
  assert.equal(normalizePricingModelKey("gpt-5.3-codex-spark"), "gpt-5.3-codex")
})

test("buildObservedPricingCoverageRows keeps Gauge Forge visible while linking to canonical pricing", () => {
  const rows = buildObservedPricingCoverageRows({
    usageFacts: [{
      provider_id: "gauge-forge-openai",
      model_id: "gpt-5.4",
      time_created: 1_746_500_000,
      total_tokens: 1200,
    }],
    pricingRows: [{
      id: "openai:gpt-5.4",
      canonical_vendor: "openai",
      canonical_model: "gpt-5.4",
      vendor_model_id: "gpt-5.4",
      currency: "USD",
      input_price: 2.5,
      output_price: 15,
      reasoning_price: 15,
      reasoning_billing_rule_json: JSON.stringify({ kind: "per_token", provenance: { sourceType: "official", sourceUrl: "https://developers.openai.com/api/docs/pricing" } }),
      cache_read_price: 0.25,
      cache_write_price: 0,
      source_type: "official",
      source_url: "https://developers.openai.com/api/docs/pricing",
      confidence: "high",
      is_manual_override: 0,
      observed_time: 1_746_499_000,
      enabled: 1,
      effective_time: 1_746_499_000,
      superseded_time: null,
    }],
    asOfTime: 1_746_500_000,
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].observedProviderId, "gauge-forge-openai")
  assert.equal(rows[0].observedModelId, "gpt-5.4")
  assert.equal(rows[0].canonicalVendor, "openai")
  assert.equal(rows[0].canonicalModel, "gpt-5.4")
  assert.equal(rows[0].sourceType, "official")
})

test("buildObservedPricingCoverageRows aggregates repeated observed provider/model usage and normalizes timestamps", () => {
  const rows = buildObservedPricingCoverageRows({
    usageFacts: [
      {
        provider_id: "gauge-forge-openai",
        model_id: "gpt-5.4",
        time_created: 1_746_500_000_999,
        total_tokens: 1200,
      },
      {
        provider_id: "gauge-forge-openai",
        model_id: "gpt-5.4",
        time_created: 1_746_499_000,
        total_tokens: 300,
      },
    ],
    pricingRows: [officialPricingRow({
      id: "openai:gpt-5.4",
      modelId: "gpt-5.4",
      effectiveTime: 1_746_498_000,
    })],
    asOfTime: 1_746_501_000,
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].messageCount, 2)
  assert.equal(rows[0].totalTokens, 1500)
  assert.equal(rows[0].firstSeen, 1_746_499_000)
  assert.equal(rows[0].lastSeen, 1_746_500_000)
})

test("buildObservedPricingCoverageRows resolves pricing deterministically at asOfTime instead of first usage time", () => {
  const rows = buildObservedPricingCoverageRows({
    usageFacts: [
      {
        provider_id: "gauge-forge-openai",
        model_id: "gpt-5.4",
        time_created: 1_746_400_000,
        total_tokens: 100,
      },
      {
        provider_id: "gauge-forge-openai",
        model_id: "gpt-5.4",
        time_created: 1_746_600_000,
        total_tokens: 200,
      },
    ],
    pricingRows: [officialPricingRow({
      id: "openai:gpt-5.4",
      modelId: "gpt-5.4",
      effectiveTime: 1_746_500_000,
    })],
    asOfTime: 1_746_550_000,
  })

  assert.equal(rows[0].resolutionStatus, "priced")
  assert.equal(rows[0].canonicalRecordId, "openai:gpt-5.4")
})

test("buildObservedPricingCoverageRows reports missing when canonical pricing is not effective at asOfTime", () => {
  const rows = buildObservedPricingCoverageRows({
    usageFacts: [{
      provider_id: "gauge-forge-openai",
      model_id: "gpt-5.4",
      time_created: 1_746_600_000,
      total_tokens: 200,
    }],
    pricingRows: [officialPricingRow({
      id: "openai:gpt-5.4",
      modelId: "gpt-5.4",
      effectiveTime: 1_746_500_000,
    })],
    asOfTime: 1_746_400_000,
  })

  assert.equal(rows[0].resolutionStatus, "missing")
  assert.equal(rows[0].canonicalRecordId, null)
})

test("buildObservedPricingCoverageRows matches provider-scoped observed Spark aliases to canonical Codex pricing", () => {
  const rows = buildObservedPricingCoverageRows({
    usageFacts: [{
      provider_id: "gauge-forge-openai",
      model_id: "gauge-forge-openai/gpt-5.3-codex-spark",
      time_created: 1_746_600_000,
      total_tokens: 200,
    }],
    pricingRows: [officialPricingRow({
      id: "openai:gpt-5.3-codex",
      modelId: "gpt-5.3-codex",
      effectiveTime: 1_746_500_000,
    })],
    asOfTime: 1_746_600_000,
  })

  assert.equal(rows[0].observedProviderId, "gauge-forge-openai")
  assert.equal(rows[0].observedModelId, "gauge-forge-openai/gpt-5.3-codex-spark")
  assert.equal(rows[0].canonicalModel, "gpt-5.3-codex")
  assert.equal(rows[0].resolutionStatus, "priced")
})
